# WhatsApp Baileys Service — Design Spec

- **Date:** 2026-05-07
- **Owner:** tech@altum.ar
- **Status:** Draft
- **Scope:** Outbound-only WhatsApp service (`wa-backend`) backing the existing notifications pipeline of the prode.

## 1. Context & Goal

The prode backend already enqueues notifications through BullMQ and delivers them via a thin `WhatsappService` wrapper that posts to `${WHATSAPP_API_URL}/send` with a Bearer token. Today that URL is a placeholder; in production it must point to a real WhatsApp gateway.

This spec defines the **gateway** itself: a NestJS standalone process called `wa-backend` that connects to WhatsApp via Baileys and exposes an HTTP API for the prode backend (and only the prode backend) to send outbound messages.

### In scope

- Outbound text messages from a single WhatsApp account.
- HTTP API: `POST /send`, `GET /status`, `GET /health`.
- Session persistence on a Docker volume.
- Reconnect with exponential backoff.
- Bearer auth shared with the prode backend.

### Explicitly out of scope (future work)

- Inbound messages, command handling, opt-out via reply.
- Interactive messages (buttons / list replies / templates).
- Multi-session (more than one WhatsApp account).
- Admin UI to configure templates and cadence (acknowledged future work, separate spec).
- `POST /logout` endpoint — operator deletes the volume by hand if needed.
- Delivery / read receipts tracking via `messages.update`.

### Non-goals

- This is **not** a public API. It listens on the internal Dokploy network only.
- It does **not** persist message history or queue jobs itself — the prode backend's BullMQ owns retries and ordering.

## 2. Architecture

### 2.1 Topology

A new Nest standalone process is added to the monorepo at the root level, alongside `backend/` and `frontend/`:

```
prode/
├── backend/                  # existing Nest API (unchanged)
│   └── src/shared/whatsapp/  # existing HTTP wrapper (unchanged)
├── frontend/                 # existing Next app (unchanged)
└── wa-backend/               # NEW · Nest standalone with Baileys
    ├── src/
    │   ├── app.module.ts
    │   ├── main.ts
    │   ├── config/env.ts
    │   ├── modules/
    │   │   ├── send/                 # POST /send
    │   │   ├── status/               # GET /status, GET /health
    │   │   └── baileys/              # core: client + lifecycle
    │   └── common/
    │       ├── auth/                 # BearerGuard
    │       └── filters/              # HttpExceptionFilter
    ├── data/                         # volume → useMultiFileAuthState
    ├── Dockerfile
    └── package.json
```

The prode backend keeps using its existing `WhatsappService` wrapper. The only operational change is `WHATSAPP_API_URL` pointing to `http://wa-backend:3001` on Dokploy (and `http://localhost:3001` in dev). The wrapper code does **not** change.

### 2.2 Module layout

| Module | Responsibility | Exports |
|---|---|---|
| `BaileysModule` (`@Global()`) | Owns the `BaileysClientService` (singleton), encapsulates socket lifecycle + session store. | `BaileysClientService` |
| `SendModule` | Exposes `POST /send`, validates DTOs, delegates to `BaileysClientService.sendText`. | — |
| `StatusModule` | Exposes `GET /status` (auth) and `GET /health` (no auth). Reads in-memory state from `BaileysClientService`. | — |
| `AuthModule` (common) | Provides `BearerGuard`. | `BearerGuard` |

NestJS rules applied: `arch-feature-modules` (modules by feature, not by layer), `arch-single-responsibility` (one concern per service), `di-prefer-constructor-injection` everywhere, `arch-module-sharing` (Baileys module is `@Global()` so the singleton is reused without re-providing).

### 2.3 Data flow (happy path)

```
prode-backend (BullMQ worker)
  └── WhatsappService.send(to, message)
        POST http://wa-backend:3001/send
        Authorization: Bearer <WHATSAPP_API_TOKEN>
        body: { to, message }
              │
              ▼
wa-backend (NestJS)
  ├── BearerGuard            (compares token in constant time)
  ├── ValidationPipe         (SendMessageDto: E.164 + non-empty + ≤4096 chars)
  ├── SendController.send()  → SendService.send()
  └── BaileysClientService.sendText(to, message)
        ├── if !connected → 503 ServiceUnavailable
        ├── jid = `${digits(to)}@s.whatsapp.net`
        ├── (optional) sock.onWhatsApp(jid) → 400 if not on WA
        ├── result = await sock.sendMessage(jid, { text: message })
        ├── await sleep(WA_SEND_DELAY_MS)
        └── return { messageId: result.key.id }
              │
              ▼
prode-backend ← 200 { messageId }   (current wrapper ignores body, treats 2xx as success)
```

## 3. Baileys lifecycle

`BaileysClientService` is a singleton provider implementing `OnModuleInit` and `OnApplicationShutdown`.

### 3.1 Initialization (`onModuleInit`)

1. `const { state, saveCreds } = await useMultiFileAuthState(env.WA_AUTH_DIR)`.
2. `const sock = makeWASocket({ auth: state, printQRInTerminal: true, logger: pino({ level: 'silent' }), browser: ['ProdePlus', 'Chrome', '120'] })`.
3. Register handlers:
   - `sock.ev.on('creds.update', saveCreds)` — persists key rotations to the volume.
   - `sock.ev.on('connection.update', this.onConnectionUpdate)`.
4. Initial state: `{ connected: false, phone: null, lastSeenAt: null }`.

### 3.2 Connection state machine

`onConnectionUpdate({ connection, lastDisconnect, qr })`:

- If `qr` is present → log a single line: `WA QR available. Scan from WhatsApp → Linked devices → Link a device.` (Baileys prints the QR PNG to stdout itself.)
- If `connection === 'open'`:
  - `connected = true`
  - `phone = sock.user?.id?.split(':')[0]?.split('@')[0] ?? null`
  - `lastSeenAt = new Date()`
  - log `WA connected (phone=…)`.
- If `connection === 'close'`:
  - `connected = false`
  - `const code = (lastDisconnect?.error as Boom)?.output?.statusCode`
  - If `code === DisconnectReason.loggedOut` → log error and **do not reconnect** (operator must re-scan QR; deletes the volume or logs in to a new number).
  - Otherwise → schedule a reconnect via exponential backoff.

### 3.3 Reconnect backoff

- Sequence (ms): `1000, 2000, 5000, 15000, 30000, 60000` (cap at `WA_RECONNECT_MAX_BACKOFF_MS`).
- After cap, keep retrying every `WA_RECONNECT_MAX_BACKOFF_MS`.
- Each attempt logs `WA reconnect attempt n=<i> backoff=<ms>ms`.
- A reconnect re-runs the init sequence: `useMultiFileAuthState` (reads existing creds), `makeWASocket`, re-register handlers.
- Attempts are cleared on successful `'open'`.

### 3.4 Graceful shutdown (`onApplicationShutdown`)

- Cancel any pending reconnect timer.
- `sock?.end(undefined)` — closes the WS without logging out.
- Do **not** delete the auth directory.

`devops-graceful-shutdown` and `perf-async-hooks` apply.

### 3.5 `sendText(to, message): Promise<{ messageId: string }>`

1. If `!connected` → throw `ServiceUnavailableException('WhatsApp not connected')`.
2. Normalize: `digits = to.replace(/\D/g, '')`. If empty → `BadRequestException`.
3. `jid = `${digits}@s.whatsapp.net``.
4. If `env.WA_VERIFY_RECIPIENT === true`:
   - `const [info] = await sock.onWhatsApp(jid)`.
   - If `!info?.exists` → throw `BadRequestException('Recipient is not on WhatsApp')`.
5. `const result = await sock.sendMessage(jid, { text: message })`.
6. `await sleep(env.WA_SEND_DELAY_MS)` — minimal antispam throttle.
7. Return `{ messageId: result.key.id }`.

Any thrown error from Baileys propagates as `BadGatewayException(502)` via `HttpExceptionFilter` so the prode backend's BullMQ retries.

## 4. HTTP contract

### 4.1 Endpoints

| Method | Path | Auth | Status codes |
|---|---|---|---|
| `POST` | `/send` | Bearer | 200, 400, 401, 502, 503 |
| `GET` | `/status` | Bearer | 200, 401 |
| `GET` | `/health` | none | 200 |

### 4.2 `POST /send`

Request:

```json
{ "to": "+5491166...", "message": "Hola" }
```

DTO (`class-validator`):

```ts
export class SendMessageDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'to must be E.164 (8–15 digits)' })
  to!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  message!: string;
}
```

Response 200:

```json
{ "messageId": "3EB0..." }
```

Errors:

- `400 BadRequest` — DTO invalid; or recipient not on WA when `WA_VERIFY_RECIPIENT=true`.
- `401 Unauthorized` — missing or invalid Bearer.
- `502 BadGateway` — Baileys threw while sending.
- `503 ServiceUnavailable` — `connected === false` (handler not yet linked or in reconnect).

The current prode wrapper treats anything non-2xx as a failure and surfaces it to BullMQ for retry/backoff. That contract is preserved.

### 4.3 `GET /status`

Response 200:

```json
{ "connected": true, "phone": "5491166...", "lastSeenAt": "2026-05-07T15:42:11.123Z" }
```

`phone` and `lastSeenAt` are `null` when never connected.

### 4.4 `GET /health`

Response 200:

```json
{ "ok": true }
```

No auth (Dokploy liveness probe). Returns 200 as long as the process is alive — does **not** assert WhatsApp connectivity. The admin uses `/status` for that.

### 4.5 Auth (`BearerGuard`)

- Reads `Authorization: Bearer <token>`.
- Compares against `env.WA_API_TOKEN` using `crypto.timingSafeEqual` over equal-length buffers.
- On mismatch or missing → `UnauthorizedException`.
- Applied via `@UseGuards(BearerGuard)` on `SendController` and `StatusController.status`. `StatusController.health` skips the guard.

`security-use-guards`, `security-validate-all-input`, `security-rate-limiting` (via global `@nestjs/throttler` — a generous 60 req/min cap as a safety net; real throttle is the `WA_SEND_DELAY_MS` inside `BaileysClientService`).

### 4.6 Errors

A single `HttpExceptionFilter` returns:

```json
{ "statusCode": 503, "error": "ServiceUnavailable",
  "message": "WhatsApp not connected", "timestamp": "...", "path": "/send" }
```

`error-use-exception-filters`, `error-throw-http-exceptions`.

## 5. Configuration

`wa-backend` env (loaded with `@nestjs/config` + zod, mirroring how `backend/` does it):

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3001` | Internal HTTP port |
| `WA_API_TOKEN` | — (required) | Same value as `WHATSAPP_API_TOKEN` in `backend/.env` |
| `WA_AUTH_DIR` | `./data/auth` | Directory for `useMultiFileAuthState` |
| `WA_SEND_DELAY_MS` | `500` | Sleep after each successful send |
| `WA_VERIFY_RECIPIENT` | `false` | If `true`, calls `sock.onWhatsApp` before sending |
| `WA_RECONNECT_MAX_BACKOFF_MS` | `60000` | Reconnect backoff cap |
| `LOG_LEVEL` | `info` | Pino logger level |

Backend (prode) env changes:

- `WHATSAPP_API_URL` → `http://wa-backend:3001` (Dokploy) or `http://localhost:3001` (dev).
- No code change in the wrapper.

`devops-use-config-module` applied.

## 6. Deployment

### 6.1 Dockerfile

Multi-stage, Node 20 alpine:

```Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

### 6.2 Dokploy

- New service `wa-backend` in the same project as `backend` and `frontend`.
- **Persistent volume** mounted at `/app/data` (Baileys writes `auth/` here).
- **Healthcheck** HTTP `GET /health`.
- **Internal network only** — not exposed publicly. The `backend` reaches it as `http://wa-backend:3001`.
- **Logs** are read via the Dokploy UI; QR appears there on first boot or after a `loggedOut`.
- **Env vars** as listed in section 5.

### 6.3 Bootstrap procedure (one-time per number)

1. Deploy `wa-backend`.
2. Open Dokploy logs.
3. From WhatsApp on the phone for the prode number → Settings → Linked devices → Link a device → scan the QR shown in the logs.
4. Logs confirm `WA connected (phone=...)`. Sessions persist across restarts via the volume.

## 7. Logging & observability

- Pino structured logger (`devops-use-logging`).
- Levels:
  - `info`: connect/disconnect transitions, send success (with messageId), QR available.
  - `warn`: send failures, reconnect attempts.
  - `error`: `loggedOut` (manual intervention required), uncaught.
- Each `/send` log line includes `to_redacted` (last 4 digits) — never the full number, never the message body.
- Optional future: a `/metrics` endpoint with Prometheus counters (`wa_sent_total`, `wa_send_failed_total`, `wa_reconnects_total`, `wa_connected`). Not in scope for v1.

## 8. Security

- Bearer auth on all non-health endpoints; constant-time compare.
- Service is internal-only; the Dokploy network does not expose it publicly.
- DTOs validate everything; no other input surface exists.
- The auth directory holds Signal-protocol private keys — the volume is treated as a secret. Backups (if added later) must be encrypted at rest.
- No secrets are logged; `to` is redacted in logs; `message` body is never logged.

`security-validate-all-input`, `security-use-guards`, `security-sanitize-output` (errors don't leak internals).

## 9. Testing

`test-use-testing-module` and `test-mock-external-services`:

### 9.1 Unit

- `SendController` with a mocked `BaileysClientService`:
  - 401 when Bearer is missing/wrong.
  - 400 when DTO is invalid (`to` not E.164, `message` empty, `message` > 4096).
  - 503 when `BaileysClientService.sendText` throws `ServiceUnavailableException`.
  - 502 when it throws a generic error.
  - 200 with `messageId` on success.
- `StatusController`:
  - `/health` returns 200 without auth.
  - `/status` requires Bearer; returns the in-memory state of `BaileysClientService`.
- `BaileysClientService.sendText` with a mocked `sock`:
  - throws when `!connected`.
  - normalizes `to` (with/without `+`, with spaces) to a clean jid.
  - rejects when `WA_VERIFY_RECIPIENT=true` and `onWhatsApp` returns `exists=false`.
  - returns `{ messageId }` on success.
- `onConnectionUpdate` handler scenarios:
  - `loggedOut` → no reconnect scheduled.
  - generic close → reconnect scheduled with backoff.
  - `qr` present → log emitted, no state change.
  - `open` → state updates with phone + timestamp.

### 9.2 e2e

- Supertest against the full app with `BaileysClientService` provider mocked at `Test.createTestingModule` level (`test-e2e-supertest`):
  - Round-trip on each of `/send`, `/status`, `/health`.

### 9.3 Out of scope for automated tests

- No automated test against a real WhatsApp account. Manual smoke after deploy.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| WhatsApp bans the number for spam | Low volume; `WA_SEND_DELAY_MS=500` baseline; future admin UI for cadence already noted. |
| Volume loss → session loss | Operator re-scans QR; documented in section 6.3. Future: encrypted backup of `WA_AUTH_DIR`. |
| Baileys library breaking changes | Pin exact version in `package.json`; version bumps go through PR review. |
| WA `loggedOut` (manual logout, account banned, multi-device limit hit) | Surfaced via `/status` (`connected=false`) and error logs. Operator re-scans. |
| Concurrent restarts corrupting auth files | Single replica only (no HA). If multi-replica is ever needed, switch session store to Postgres. |
| Token leak | Internal-only deployment + constant-time compare; rotate by changing env on both `backend` and `wa-backend`. |

## 11. Open questions / parking lot

- **Admin UI for templates and cadence.** Acknowledged as future work; needs its own brainstorm (which templates, who can send, audit, scheduling).
- **Delivery / read receipts.** Subscribing to `messages.update` would let the prode show "delivered/read" — not in v1.
- **Number verification cost.** `WA_VERIFY_RECIPIENT=true` adds a round-trip per send. Default off; flip on if operator sees too many sends to non-WA numbers.

## 12. Acceptance checklist

- [ ] `wa-backend/` exists in the monorepo with the module layout in §2.2.
- [ ] `BaileysClientService` initializes, persists creds via `useMultiFileAuthState`, reconnects with backoff, shuts down cleanly.
- [ ] `POST /send`, `GET /status`, `GET /health` behave per §4 with the documented status codes.
- [ ] `BearerGuard` rejects missing/invalid tokens with constant-time compare.
- [ ] Unit + e2e tests pass; coverage on the connection state machine.
- [ ] Dockerfile builds; Dokploy service runs with persistent volume; QR is visible in logs on first boot.
- [ ] `backend`'s `WHATSAPP_API_URL` updated; existing notification BullMQ jobs deliver successfully end-to-end.

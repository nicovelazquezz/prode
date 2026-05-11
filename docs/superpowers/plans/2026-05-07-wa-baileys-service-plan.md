# WhatsApp Baileys Service — Implementation Plan

> **For Claude:** Use executing-plans skill to implement this plan task-by-task. Reference `docs/superpowers/specs/2026-05-07-wa-baileys-service-design.md` for the *what*; this plan instructs *how*.

## Remember
- Exact file paths always — root is `/Users/nicolasvelazquez/Desktop/dev/prode/`.
- Complete code in plan for non-obvious logic; minimal scaffolding for obvious wiring.
- Exact commands with expected output.
- DRY, YAGNI, TDD, frequent commits (1 commit per phase minimum).
- New service code lives in `wa-backend/`. Backend (`backend/`) and frontend (`frontend/`) do **not** change except where noted in Phase 6.
- KISS: no extras beyond the spec. No metrics, no inbound, no buttons, no logout endpoint.

## Overview

Outbound-only WhatsApp gateway as a separate Nest standalone process at `wa-backend/`. Backed by Baileys with `useMultiFileAuthState` on a Docker volume. Exposes `POST /send`, `GET /status`, `GET /health` over the internal Dokploy network. The existing `WhatsappService` HTTP wrapper at `backend/src/shared/whatsapp/whatsapp.service.ts` keeps working unchanged once `WHATSAPP_API_URL` is repointed.

**Spec (authoritative):** `docs/superpowers/specs/2026-05-07-wa-baileys-service-design.md`

**Stack:** NestJS 11 + @whiskeysockets/baileys + class-validator + zod + pino + jest + supertest. Node 20 LTS.

## Prerequisites

- [ ] Node.js ≥ 20.19 (`node -v`).
- [ ] npm ≥ 10 (`npm -v`).
- [ ] Docker Desktop running (`docker info`) — needed for Phase 6 image build.
- [ ] A spare WhatsApp account/number (the prode number) ready to scan a QR.
- [ ] Dokploy project with `backend` and `frontend` services already deployed (existing).

## Phase plan

| Phase | Name | Tasks | Verifiable output |
|------|--------|--------|---------------------|
| 1 | Scaffold + config | 4 | `npm run build` succeeds; `loadEnv` validates env |
| 2 | Auth + filter | 2 | `BearerGuard` rejects bad tokens; filter formats errors |
| 3 | Baileys client + lifecycle | 3 | Unit tests cover state machine + sendText |
| 4 | HTTP modules (send + status) | 3 | Unit tests pass for both controllers |
| 5 | App wiring + main + e2e | 2 | e2e via supertest covers all 3 endpoints |
| 6 | Docker + Dokploy + backend env | 3 | Image builds; Dokploy service runs; `/status` reports `connected: true` after QR scan |

**Total: 17 tasks across 6 phases.**

---

# PHASE 1 — Scaffold + config

**Goal:** the empty Nest app builds and `loadEnv()` validates env vars.

### Task 1.1 — Scaffold `wa-backend/` package

**Files created:**
- `wa-backend/package.json`
- `wa-backend/tsconfig.json`
- `wa-backend/tsconfig.build.json`
- `wa-backend/nest-cli.json`
- `wa-backend/.gitignore`
- `wa-backend/.dockerignore`
- `wa-backend/.env.example`
- `wa-backend/jest.config.js`
- `wa-backend/data/.gitkeep`

**`wa-backend/package.json`:**

```json
{
  "name": "wa-backend",
  "version": "1.0.0",
  "description": "WhatsApp Baileys gateway for prode",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/src/main.js",
    "test": "node --experimental-vm-modules --require dotenv/config node_modules/jest/bin/jest.js",
    "test:watch": "npm run test -- --watch",
    "test:e2e": "npm run test -- --config jest-e2e.config.js"
  },
  "engines": { "node": ">=20.19" },
  "dependencies": {
    "@nestjs/common": "^11.1.19",
    "@nestjs/config": "^4.0.4",
    "@nestjs/core": "^11.1.19",
    "@nestjs/platform-express": "^11.1.19",
    "@whiskeysockets/baileys": "^6.7.18",
    "@hapi/boom": "^10.0.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.2",
    "nestjs-pino": "^4.4.0",
    "pino": "^9.5.0",
    "pino-http": "^10.4.0",
    "qrcode-terminal": "^0.12.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.5",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.1.19",
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.4",
    "@types/supertest": "^6.0.2",
    "dotenv": "^16.4.5",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

**`wa-backend/tsconfig.json`:**

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "outDir": "./dist",
    "baseUrl": "./",
    "rootDir": "./",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "incremental": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**`wa-backend/tsconfig.build.json`:**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts", "jest.config.js"]
}
```

**`wa-backend/nest-cli.json`:**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

**`wa-backend/.gitignore`:**

```
node_modules/
dist/
data/auth/
*.log
.env
.env.local
coverage/
```

**`wa-backend/.dockerignore`:**

```
node_modules
dist
data
.env
.env.*
coverage
*.log
.git
```

**`wa-backend/.env.example`:**

```
PORT=3001
WA_API_TOKEN=replace-with-same-value-as-WHATSAPP_API_TOKEN
WA_AUTH_DIR=./data/auth
WA_SEND_DELAY_MS=500
WA_VERIFY_RECIPIENT=false
WA_RECONNECT_MAX_BACKOFF_MS=60000
LOG_LEVEL=info
```

**`wa-backend/jest.config.js`:**

```js
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }]
  },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  extensionsToTreatAsEsm: ['.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/']
};
```

**`wa-backend/data/.gitkeep`:** empty file (just to keep the dir).

#### Verification

```bash
cd wa-backend && npm install && npx tsc --noEmit
# Expected: exit 0, no errors. node_modules populated.
```

### Task 1.2 — Add a placeholder `src/main.ts` and `src/app.module.ts` so build works

**File:** `wa-backend/src/app.module.ts`

```ts
import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
```

**File:** `wa-backend/src/main.ts`

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
```

#### Verification

```bash
cd wa-backend && npm run build
# Expected: dist/ created with src/main.js and src/app.module.js. Exit 0.
```

### Task 1.3 — `src/config/env.ts` with zod (test first)

**Test file:** `wa-backend/src/config/env.spec.ts`

```ts
import { describe, it, expect } from '@jest/globals';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  const valid = {
    PORT: '3001',
    WA_API_TOKEN: 'a'.repeat(32),
    WA_AUTH_DIR: './data/auth',
    WA_SEND_DELAY_MS: '500',
    WA_VERIFY_RECIPIENT: 'false',
    WA_RECONNECT_MAX_BACKOFF_MS: '60000',
    LOG_LEVEL: 'info'
  };

  it('parses a valid env into typed values', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3001);
    expect(env.WA_SEND_DELAY_MS).toBe(500);
    expect(env.WA_VERIFY_RECIPIENT).toBe(false);
  });

  it('throws when WA_API_TOKEN is missing', () => {
    const { WA_API_TOKEN: _omit, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(/WA_API_TOKEN/);
  });

  it('throws when WA_API_TOKEN is shorter than 16 chars', () => {
    expect(() => parseEnv({ ...valid, WA_API_TOKEN: 'short' })).toThrow(/WA_API_TOKEN/);
  });

  it('applies defaults for optional vars', () => {
    const minimal = { WA_API_TOKEN: 'a'.repeat(32) };
    const env = parseEnv(minimal);
    expect(env.PORT).toBe(3001);
    expect(env.WA_AUTH_DIR).toBe('./data/auth');
    expect(env.WA_SEND_DELAY_MS).toBe(500);
    expect(env.WA_VERIFY_RECIPIENT).toBe(false);
    expect(env.WA_RECONNECT_MAX_BACKOFF_MS).toBe(60_000);
    expect(env.LOG_LEVEL).toBe('info');
  });
});
```

**Implementation:** `wa-backend/src/config/env.ts`

```ts
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  WA_API_TOKEN: z.string().min(16, 'WA_API_TOKEN must be at least 16 chars'),
  WA_AUTH_DIR: z.string().default('./data/auth'),
  WA_SEND_DELAY_MS: z.coerce.number().int().min(0).default(500),
  WA_VERIFY_RECIPIENT: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(false),
  WA_RECONNECT_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(60_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid env — ${issues}`);
  }
  return result.data;
}

let cached: Env | null = null;
export function loadEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
```

#### Verification

```bash
cd wa-backend && npm test -- --testPathPattern env.spec
# Expected: PASS  src/config/env.spec.ts (4 tests passed)
```

### Task 1.4 — Commit phase 1

```bash
git add wa-backend && git commit -m "feat(wa-backend): scaffold + env config (P1)"
```

---

# PHASE 2 — Auth guard + global error filter

### Task 2.1 — `BearerGuard` with constant-time compare (test first)

**Test:** `wa-backend/src/common/auth/bearer.guard.spec.ts`

```ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BearerGuard } from './bearer.guard.js';

const TOKEN = 'a'.repeat(32);

function ctxWithHeader(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) })
  } as unknown as ExecutionContext;
}

describe('BearerGuard', () => {
  let guard: BearerGuard;

  beforeEach(() => {
    guard = new BearerGuard({ WA_API_TOKEN: TOKEN } as any);
  });

  it('allows when Bearer token matches', () => {
    expect(guard.canActivate(ctxWithHeader(`Bearer ${TOKEN}`))).toBe(true);
  });

  it('rejects when Authorization header is missing', () => {
    expect(() => guard.canActivate(ctxWithHeader())).toThrow(UnauthorizedException);
  });

  it('rejects when scheme is not Bearer', () => {
    expect(() => guard.canActivate(ctxWithHeader(`Basic ${TOKEN}`))).toThrow(UnauthorizedException);
  });

  it('rejects when token differs', () => {
    expect(() => guard.canActivate(ctxWithHeader(`Bearer ${'b'.repeat(32)}`))).toThrow(UnauthorizedException);
  });

  it('rejects when token length differs (no timing leak)', () => {
    expect(() => guard.canActivate(ctxWithHeader(`Bearer short`))).toThrow(UnauthorizedException);
  });
});
```

**Implementation:** `wa-backend/src/common/auth/bearer.guard.ts`

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env.js';
import { loadEnv } from '../../config/env.js';

@Injectable()
export class BearerGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(env: Env = loadEnv()) {
    this.expected = Buffer.from(env.WA_API_TOKEN, 'utf8');
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing or invalid Bearer token');
    }
    const token = Buffer.from(header.slice(7).trim(), 'utf8');
    if (token.length !== this.expected.length) {
      throw new UnauthorizedException('Missing or invalid Bearer token');
    }
    if (!timingSafeEqual(token, this.expected)) {
      throw new UnauthorizedException('Missing or invalid Bearer token');
    }
    return true;
  }
}
```

#### Verification

```bash
cd wa-backend && npm test -- --testPathPattern bearer.guard
# Expected: PASS (5 tests).
```

### Task 2.2 — Global `HttpExceptionFilter`

**File:** `wa-backend/src/common/filters/http-exception.filter.ts`

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        message = (body as { message?: string | object }).message ?? body;
        error = (body as { error?: string }).error ?? exception.name;
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error on ${req.method} ${req.url}: ${exception.message}`, exception.stack);
      message = exception.message;
    }

    res.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: req.url
    });
  }
}
```

No dedicated unit test — it is exercised by the e2e tests in Phase 5.

#### Verification

```bash
cd wa-backend && npm run build
# Expected: exit 0.
```

### Task 2.3 — Commit phase 2

```bash
git add wa-backend && git commit -m "feat(wa-backend): bearer guard + global error filter (P2)"
```

---

# PHASE 3 — Baileys client + lifecycle

This phase contains the only piece that warrants careful TDD: the connection state machine. We split into a pure state-class (testable without a socket) and a thin orchestrator that wires the real Baileys events.

### Task 3.1 — `BaileysConnectionState` pure class (test first)

A small, pure class that holds the public state and computes the next reconnect backoff. Decoupled from Baileys so we can unit-test the state machine without mocking `makeWASocket`.

**Test:** `wa-backend/src/modules/baileys/baileys-connection-state.spec.ts`

```ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { BaileysConnectionState } from './baileys-connection-state.js';

describe('BaileysConnectionState', () => {
  let s: BaileysConnectionState;

  beforeEach(() => {
    s = new BaileysConnectionState({ maxBackoffMs: 60_000 });
  });

  it('starts disconnected with null phone and lastSeenAt', () => {
    expect(s.snapshot()).toEqual({ connected: false, phone: null, lastSeenAt: null });
  });

  it('markConnected sets connected, phone, and a timestamp', () => {
    s.markConnected('5491166...');
    const snap = s.snapshot();
    expect(snap.connected).toBe(true);
    expect(snap.phone).toBe('5491166...');
    expect(snap.lastSeenAt).toBeInstanceOf(Date);
  });

  it('markDisconnected drops connected to false but keeps phone (last known)', () => {
    s.markConnected('5491166...');
    s.markDisconnected();
    const snap = s.snapshot();
    expect(snap.connected).toBe(false);
    expect(snap.phone).toBe('5491166...');
  });

  it('nextBackoffMs follows 1s,2s,5s,15s,30s,60s and caps', () => {
    expect(s.nextBackoffMs()).toBe(1000);
    expect(s.nextBackoffMs()).toBe(2000);
    expect(s.nextBackoffMs()).toBe(5000);
    expect(s.nextBackoffMs()).toBe(15_000);
    expect(s.nextBackoffMs()).toBe(30_000);
    expect(s.nextBackoffMs()).toBe(60_000);
    expect(s.nextBackoffMs()).toBe(60_000);
  });

  it('resetBackoff restarts the sequence', () => {
    s.nextBackoffMs();
    s.nextBackoffMs();
    s.resetBackoff();
    expect(s.nextBackoffMs()).toBe(1000);
  });
});
```

**Implementation:** `wa-backend/src/modules/baileys/baileys-connection-state.ts`

```ts
export interface ConnectionSnapshot {
  connected: boolean;
  phone: string | null;
  lastSeenAt: Date | null;
}

export class BaileysConnectionState {
  private static readonly STEPS = [1000, 2000, 5000, 15_000, 30_000, 60_000] as const;

  private connected = false;
  private phone: string | null = null;
  private lastSeenAt: Date | null = null;
  private attempt = 0;

  constructor(private readonly opts: { maxBackoffMs: number }) {}

  snapshot(): ConnectionSnapshot {
    return { connected: this.connected, phone: this.phone, lastSeenAt: this.lastSeenAt };
  }

  markConnected(phone: string): void {
    this.connected = true;
    this.phone = phone;
    this.lastSeenAt = new Date();
    this.resetBackoff();
  }

  markDisconnected(): void {
    this.connected = false;
  }

  nextBackoffMs(): number {
    const idx = Math.min(this.attempt, BaileysConnectionState.STEPS.length - 1);
    const step = BaileysConnectionState.STEPS[idx];
    this.attempt += 1;
    return Math.min(step, this.opts.maxBackoffMs);
  }

  resetBackoff(): void {
    this.attempt = 0;
  }
}
```

#### Verification

```bash
cd wa-backend && npm test -- --testPathPattern baileys-connection-state
# Expected: PASS (5 tests).
```

### Task 3.2 — `BaileysClientService` (test first for `sendText` + handler)

Two unit tests cover what we can without a real socket:
1. `sendText` behaviour with a mocked `sock` (refuses when disconnected, formats jid, optionally verifies recipient, returns `messageId`, sleeps `WA_SEND_DELAY_MS`).
2. The `connection.update` handler calls into `BaileysConnectionState` correctly for `open`, `close (loggedOut)`, `close (other)`, and `qr`.

**Test:** `wa-backend/src/modules/baileys/baileys.client.service.spec.ts`

```ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { BaileysClientService } from './baileys.client.service.js';
import { BaileysConnectionState } from './baileys-connection-state.js';

const ENV = {
  WA_AUTH_DIR: './data/auth',
  WA_SEND_DELAY_MS: 0,
  WA_VERIFY_RECIPIENT: false,
  WA_RECONNECT_MAX_BACKOFF_MS: 60_000
} as any;

function svc(overrides: Partial<typeof ENV> = {}) {
  const s = new BaileysClientService({ ...ENV, ...overrides });
  // Inject a state and a fake sock so we can test in isolation.
  (s as any).state = new BaileysConnectionState({ maxBackoffMs: 60_000 });
  return s;
}

describe('BaileysClientService.sendText', () => {
  it('throws ServiceUnavailable when not connected', async () => {
    const s = svc();
    await expect(s.sendText('+5491166...', 'hi')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('builds a jid from digits and forwards to sock.sendMessage', async () => {
    const s = svc();
    (s as any).state.markConnected('5491166...');
    const sendMessage = jest.fn().mockResolvedValue({ key: { id: 'WAMID-1' } });
    (s as any).sock = { sendMessage, onWhatsApp: jest.fn() };

    const result = await s.sendText('+54 9 11 6666-0000', 'hola');
    expect(sendMessage).toHaveBeenCalledWith('5491166660000@s.whatsapp.net', { text: 'hola' });
    expect(result).toEqual({ messageId: 'WAMID-1' });
  });

  it('verifies recipient when WA_VERIFY_RECIPIENT=true and rejects when not on WA', async () => {
    const s = svc({ WA_VERIFY_RECIPIENT: true });
    (s as any).state.markConnected('5491166...');
    const onWhatsApp = jest.fn().mockResolvedValue([{ exists: false }]);
    (s as any).sock = { sendMessage: jest.fn(), onWhatsApp };

    await expect(s.sendText('+5491166660000', 'hola')).rejects.toBeInstanceOf(BadRequestException);
    expect(onWhatsApp).toHaveBeenCalled();
  });
});

describe('BaileysClientService.handleConnectionUpdate', () => {
  let s: BaileysClientService;
  let scheduleReconnect: jest.Mock;

  beforeEach(() => {
    s = svc();
    scheduleReconnect = jest.fn();
    (s as any).scheduleReconnect = scheduleReconnect;
  });

  it('marks connected on connection=open with phone parsed from sock.user.id', () => {
    (s as any).sock = { user: { id: '5491166660000:42@s.whatsapp.net' } };
    (s as any).handleConnectionUpdate({ connection: 'open' });
    const snap = (s as any).state.snapshot();
    expect(snap.connected).toBe(true);
    expect(snap.phone).toBe('5491166660000');
  });

  it('schedules reconnect on close with non-loggedOut error', () => {
    const err = new Boom('boom', { statusCode: 500 });
    (s as any).handleConnectionUpdate({ connection: 'close', lastDisconnect: { error: err } });
    expect((s as any).state.snapshot().connected).toBe(false);
    expect(scheduleReconnect).toHaveBeenCalled();
  });

  it('does NOT reconnect on loggedOut', () => {
    const err = new Boom('logged out', { statusCode: DisconnectReason.loggedOut });
    (s as any).handleConnectionUpdate({ connection: 'close', lastDisconnect: { error: err } });
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });

  it('logs but does not change state when only qr is present', () => {
    (s as any).handleConnectionUpdate({ qr: '2@abc...' });
    expect((s as any).state.snapshot().connected).toBe(false);
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });
});
```

**Implementation:** `wa-backend/src/modules/baileys/baileys.client.service.ts`

```ts
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  ServiceUnavailableException,
  BadRequestException,
  BadGatewayException
} from '@nestjs/common';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type ConnectionState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import type { Env } from '../../config/env.js';
import { loadEnv } from '../../config/env.js';
import { BaileysConnectionState, type ConnectionSnapshot } from './baileys-connection-state.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@Injectable()
export class BaileysClientService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BaileysClientService.name);
  private readonly env: Env;
  private state!: BaileysConnectionState;
  private sock: WASocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private saveCreds: (() => Promise<void>) | null = null;
  private shuttingDown = false;

  constructor(env: Env = loadEnv()) {
    this.env = env;
    this.state = new BaileysConnectionState({ maxBackoffMs: env.WA_RECONNECT_MAX_BACKOFF_MS });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      await this.sock?.end(undefined);
    } catch (err) {
      this.logger.warn(`Error during shutdown end(): ${(err as Error).message}`);
    }
  }

  snapshot(): ConnectionSnapshot {
    return this.state.snapshot();
  }

  async sendText(to: string, message: string): Promise<{ messageId: string }> {
    if (!this.state.snapshot().connected || !this.sock) {
      throw new ServiceUnavailableException('WhatsApp not connected');
    }
    const digits = to.replace(/\D/g, '');
    if (!digits) throw new BadRequestException('Recipient is empty');
    const jid = `${digits}@s.whatsapp.net`;

    if (this.env.WA_VERIFY_RECIPIENT) {
      const [info] = await this.sock.onWhatsApp(jid);
      if (!info?.exists) throw new BadRequestException('Recipient is not on WhatsApp');
    }

    let messageId: string;
    try {
      const result = await this.sock.sendMessage(jid, { text: message });
      messageId = result?.key?.id ?? '';
    } catch (err) {
      this.logger.warn(`sendMessage failed for ${this.redact(digits)}: ${(err as Error).message}`);
      throw new BadGatewayException('Failed to send message');
    }

    if (this.env.WA_SEND_DELAY_MS > 0) await sleep(this.env.WA_SEND_DELAY_MS);
    this.logger.log(`sent to=${this.redact(digits)} id=${messageId}`);
    return { messageId };
  }

  // -- internals ----------------------------------------------------------

  private async connect(): Promise<void> {
    const { state: authState, saveCreds } = await useMultiFileAuthState(this.env.WA_AUTH_DIR);
    this.saveCreds = saveCreds;
    this.sock = makeWASocket({
      auth: authState,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['ProdePlus', 'Chrome', '120']
    });
    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', (u) => this.handleConnectionUpdate(u));
  }

  private handleConnectionUpdate(u: Partial<ConnectionState>): void {
    if (u.qr) {
      this.logger.warn('WA QR available — scan it from WhatsApp → Linked devices → Link a device.');
      qrcode.generate(u.qr, { small: true });
    }
    if (u.connection === 'open') {
      const id = this.sock?.user?.id ?? '';
      const phone = id.split(':')[0]?.split('@')[0] ?? null;
      if (phone) this.state.markConnected(phone);
      this.logger.log(`WA connected (phone=${phone})`);
    }
    if (u.connection === 'close') {
      this.state.markDisconnected();
      const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        this.logger.error('WA loggedOut — re-scan QR after deleting auth dir.');
        return;
      }
      if (this.shuttingDown) return;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const ms = this.state.nextBackoffMs();
    this.logger.warn(`WA reconnect scheduled in ${ms}ms`);
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((err) => {
        this.logger.error(`Reconnect failed: ${(err as Error).message}`);
        this.scheduleReconnect();
      });
    }, ms);
  }

  private redact(digits: string): string {
    return digits.length <= 4 ? '****' : `***${digits.slice(-4)}`;
  }
}
```

#### Verification

```bash
cd wa-backend && npm test -- --testPathPattern baileys.client.service
# Expected: PASS (7 tests).
```

### Task 3.3 — `BaileysModule` and commit

**File:** `wa-backend/src/modules/baileys/baileys.module.ts`

```ts
import { Global, Module } from '@nestjs/common';
import { BaileysClientService } from './baileys.client.service.js';

@Global()
@Module({
  providers: [BaileysClientService],
  exports: [BaileysClientService]
})
export class BaileysModule {}
```

```bash
cd wa-backend && npm run build
# Expected: exit 0.
git add wa-backend && git commit -m "feat(wa-backend): baileys client service + connection state machine (P3)"
```

---

# PHASE 4 — HTTP modules: send + status

### Task 4.1 — `SendModule` (test first)

**DTO:** `wa-backend/src/modules/send/dto/send-message.dto.ts`

```ts
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

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

**Test:** `wa-backend/src/modules/send/send.controller.spec.ts`

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { SendController } from './send.controller.js';
import { BaileysClientService } from '../baileys/baileys.client.service.js';

describe('SendController', () => {
  let controller: SendController;
  const sendText = jest.fn();

  beforeEach(async () => {
    sendText.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [SendController],
      providers: [{ provide: BaileysClientService, useValue: { sendText } }]
    })
      .overrideGuard(require('../../common/auth/bearer.guard.js').BearerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(SendController);
  });

  it('returns messageId on success', async () => {
    sendText.mockResolvedValue({ messageId: 'WAMID-1' });
    const result = await controller.send({ to: '+5491166660000', message: 'hola' });
    expect(result).toEqual({ messageId: 'WAMID-1' });
    expect(sendText).toHaveBeenCalledWith('+5491166660000', 'hola');
  });

  it('propagates ServiceUnavailable when client throws it', async () => {
    sendText.mockRejectedValue(new ServiceUnavailableException('WhatsApp not connected'));
    await expect(controller.send({ to: '+5491166660000', message: 'hola' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
```

**Controller:** `wa-backend/src/modules/send/send.controller.ts`

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../../common/auth/bearer.guard.js';
import { BaileysClientService } from '../baileys/baileys.client.service.js';
import { SendMessageDto } from './dto/send-message.dto.js';

@Controller('send')
@UseGuards(BearerGuard)
export class SendController {
  constructor(private readonly client: BaileysClientService) {}

  @Post()
  send(@Body() body: SendMessageDto): Promise<{ messageId: string }> {
    return this.client.sendText(body.to, body.message);
  }
}
```

**Module:** `wa-backend/src/modules/send/send.module.ts`

```ts
import { Module } from '@nestjs/common';
import { SendController } from './send.controller.js';

@Module({ controllers: [SendController] })
export class SendModule {}
```

#### Verification

```bash
cd wa-backend && npm test -- --testPathPattern send.controller
# Expected: PASS (2 tests).
```

### Task 4.2 — `StatusModule`

**Controllers:** `wa-backend/src/modules/status/status.controller.ts`

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../../common/auth/bearer.guard.js';
import { BaileysClientService } from '../baileys/baileys.client.service.js';

@Controller()
export class StatusController {
  constructor(private readonly client: BaileysClientService) {}

  @Get('health')
  health(): { ok: true } {
    return { ok: true };
  }

  @Get('status')
  @UseGuards(BearerGuard)
  status() {
    const snap = this.client.snapshot();
    return {
      connected: snap.connected,
      phone: snap.phone,
      lastSeenAt: snap.lastSeenAt ? snap.lastSeenAt.toISOString() : null
    };
  }
}
```

**Test:** `wa-backend/src/modules/status/status.controller.spec.ts`

```ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { StatusController } from './status.controller.js';
import { BaileysClientService } from '../baileys/baileys.client.service.js';

describe('StatusController', () => {
  let controller: StatusController;
  const clientMock = {
    snapshot: () => ({ connected: true, phone: '5491166660000', lastSeenAt: new Date('2026-05-07T12:00:00Z') })
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StatusController],
      providers: [{ provide: BaileysClientService, useValue: clientMock }]
    })
      .overrideGuard(require('../../common/auth/bearer.guard.js').BearerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(StatusController);
  });

  it('GET /health returns { ok: true }', () => {
    expect(controller.health()).toEqual({ ok: true });
  });

  it('GET /status returns the snapshot serialised', () => {
    expect(controller.status()).toEqual({
      connected: true,
      phone: '5491166660000',
      lastSeenAt: '2026-05-07T12:00:00.000Z'
    });
  });
});
```

**Module:** `wa-backend/src/modules/status/status.module.ts`

```ts
import { Module } from '@nestjs/common';
import { StatusController } from './status.controller.js';

@Module({ controllers: [StatusController] })
export class StatusModule {}
```

#### Verification

```bash
cd wa-backend && npm test -- --testPathPattern status.controller
# Expected: PASS (2 tests).
```

### Task 4.3 — Commit phase 4

```bash
git add wa-backend && git commit -m "feat(wa-backend): send + status HTTP modules (P4)"
```

---

# PHASE 5 — App wiring + main + e2e

### Task 5.1 — Wire `AppModule` and `main.ts`

**`wa-backend/src/app.module.ts`:**

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BaileysModule } from './modules/baileys/baileys.module.js';
import { SendModule } from './modules/send/send.module.js';
import { StatusModule } from './modules/status/status.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

@Module({
  imports: [BaileysModule, SendModule, StatusModule],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }]
})
export class AppModule {}
```

**`wa-backend/src/main.ts`:**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  Logger.log(`wa-backend listening on :${env.PORT}`, 'Bootstrap');
}

void bootstrap();
```

#### Verification

```bash
cd wa-backend && npm run build
# Expected: exit 0.
```

### Task 5.2 — e2e tests with supertest

**Config:** `wa-backend/jest-e2e.config.js`

```js
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }]
  },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  extensionsToTreatAsEsm: ['.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/']
};
```

**Test:** `wa-backend/test/app.e2e-spec.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { BaileysClientService } from '../src/modules/baileys/baileys.client.service.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

const TOKEN = 'a'.repeat(32);
process.env.WA_API_TOKEN = TOKEN;

describe('wa-backend (e2e)', () => {
  let app: INestApplication;
  const fakeClient = {
    onModuleInit: jest.fn(),
    onApplicationShutdown: jest.fn(),
    snapshot: () => ({ connected: true, phone: '5491166660000', lastSeenAt: new Date('2026-05-07T12:00:00Z') }),
    sendText: jest.fn().mockResolvedValue({ messageId: 'WAMID-E2E' })
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BaileysClientService)
      .useValue(fakeClient)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => app?.close());

  it('GET /health → 200', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /status without auth → 401', async () => {
    const res = await request(app.getHttpServer()).get('/status');
    expect(res.status).toBe(401);
  });

  it('GET /status with auth → 200 with snapshot', async () => {
    const res = await request(app.getHttpServer()).get('/status').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      connected: true,
      phone: '5491166660000',
      lastSeenAt: '2026-05-07T12:00:00.000Z'
    });
  });

  it('POST /send valid → 200 with messageId', async () => {
    const res = await request(app.getHttpServer())
      .post('/send')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ to: '+5491166660000', message: 'hola' });
    expect(res.status).toBe(201); // POST default in Nest is 201
    expect(res.body).toEqual({ messageId: 'WAMID-E2E' });
  });

  it('POST /send invalid DTO → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/send')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ to: 'not-a-phone', message: '' });
    expect(res.status).toBe(400);
  });

  it('POST /send without auth → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/send')
      .send({ to: '+5491166660000', message: 'hola' });
    expect(res.status).toBe(401);
  });
});
```

If the actual default for `POST /send` should be 200 (not 201) for parity with the existing wrapper expectations, add `@HttpCode(200)` to `SendController.send` and update the e2e to expect 200. The wrapper treats any 2xx as success either way; lock the choice during this task and reflect it in both files.

#### Verification

```bash
cd wa-backend && npm run test:e2e
# Expected: PASS test/app.e2e-spec.ts (6 tests).
```

### Task 5.3 — Commit phase 5

```bash
cd wa-backend && npm run build && npm test && npm run test:e2e
# Expected: build OK, all unit tests + all e2e tests green.
git add wa-backend && git commit -m "feat(wa-backend): app wiring + main + e2e (P5)"
```

---

# PHASE 6 — Docker, Dokploy, backend env

### Task 6.1 — Dockerfile

**`wa-backend/Dockerfile`:**

```Dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
```

#### Verification

```bash
cd wa-backend && docker build -t wa-backend:dev .
# Expected: image built, exit 0.
docker run --rm -e WA_API_TOKEN=$(node -e "console.log('a'.repeat(32))") -p 3001:3001 wa-backend:dev &
sleep 3
curl -sS http://localhost:3001/health
# Expected: {"ok":true}
docker stop $(docker ps -q --filter ancestor=wa-backend:dev)
```

### Task 6.2 — Dokploy compose updates

Edit `dokploy/docker-compose.yml`. Add the new `wa-backend` service. Existing `backend` service env is updated to point at it.

```yaml
services:
  # ... existing backend, frontend, postgres, redis services ...

  wa-backend:
    image: ${REGISTRY}/wa-backend:${IMAGE_TAG:-latest}
    restart: unless-stopped
    environment:
      PORT: "3001"
      WA_API_TOKEN: ${WHATSAPP_API_TOKEN}
      WA_AUTH_DIR: /app/data/auth
      WA_SEND_DELAY_MS: "500"
      WA_VERIFY_RECIPIENT: "false"
      WA_RECONNECT_MAX_BACKOFF_MS: "60000"
      LOG_LEVEL: info
    volumes:
      - wa_auth:/app/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - internal

  backend:
    # existing config ...
    environment:
      # existing envs ...
      WHATSAPP_API_URL: http://wa-backend:3001
    depends_on:
      - wa-backend

volumes:
  wa_auth:
```

(If the existing compose uses a different network name or env-loading style, mirror that — these are illustrative anchors, the goal is: same internal network, persistent volume `wa_auth`, `WHATSAPP_API_URL` repointed.)

#### Verification

```bash
# After deploying via Dokploy UI:
# 1. Read logs for wa-backend service → expect "WA QR available — scan it..." with a QR.
# 2. Scan the QR from the prode WhatsApp account.
# 3. Logs show "WA connected (phone=...)".
# 4. From the backend container shell:
docker exec -it <backend-container> sh -c 'curl -sS -H "Authorization: Bearer $WHATSAPP_API_TOKEN" http://wa-backend:3001/status'
# Expected: {"connected":true,"phone":"...","lastSeenAt":"..."}
```

### Task 6.3 — Backend `.env.example` update + commit

**Edit `backend/.env.example`:** change `WHATSAPP_API_URL` line to:

```
WHATSAPP_API_URL=http://wa-backend:3001
```

(Keep the existing `WHATSAPP_API_TOKEN` line — same token is reused.)

```bash
git add wa-backend/Dockerfile dokploy/docker-compose.yml backend/.env.example
git commit -m "feat(wa-backend): docker + dokploy service + repoint backend WHATSAPP_API_URL (P6)"
```

---

## Integration test (manual, post-deploy)

After Phase 6 is deployed:

1. Trigger a notification end-to-end from the prode backend (e.g., enqueue a test job in BullMQ that calls `WhatsappService.send` to your own number).
2. Confirm the message arrives in WhatsApp.
3. `curl` the wa-backend `/status` from inside the backend container — `connected: true`.
4. Restart the `wa-backend` container in Dokploy. After it boots, `/status` reports `connected: true` again **without re-scanning the QR** (proves the volume persists creds).

## Rollback plan

If anything breaks in production:

1. In Dokploy: revert the backend service's `WHATSAPP_API_URL` to the previous value (or empty — the wrapper falls back to dev-simulate when the host is `example.com`/`localhost`).
2. Stop the `wa-backend` service in Dokploy.
3. Locally: `git revert <P6 commit>` (and earlier phase commits if needed); push; redeploy backend.
4. The `wa-backend` volume can be left as-is for next attempt (creds remain valid as long as WhatsApp doesn't log the device out).

## Done definition

- All 17 tasks complete.
- All unit and e2e tests pass.
- Docker image builds locally.
- Dokploy `wa-backend` service deployed and connected (QR scanned once).
- `backend` notification BullMQ job successfully delivers a real WhatsApp message end-to-end.
- Spec acceptance checklist (§12) all checked.

# Deployment — Prode Mundial 2026 Backend

Manual runbook for deploying the backend to production via **Dokploy** on the Tiro Federal VPS. All commands assume the operator is logged into the Dokploy panel and has shell access to the host.

> The repo ships everything needed for a reproducible deploy: `backend/Dockerfile` (multi-stage, runs migrations on start) and `dokploy/docker-compose.yml` (postgres + redis + backend). Secrets and env vars live in the Dokploy panel — never in git.

---

## 1. Prerequisites

- VPS with Dokploy installed and Traefik running (Dokploy ships it).
- DNS: `api.prode.tirofederal.com` → VPS public IP (A record).
- Git repo accessible to Dokploy (HTTPS or deploy key).
- Backblaze B2 bucket created for backups (see §6).

---

## 2. Create the project in Dokploy

1. Panel → **Projects** → **Create**.
2. Name: `prode`.
3. Add a **Compose** application:
   - **Source**: Git provider, branch `main`.
   - **Compose file path**: `dokploy/docker-compose.yml`.
   - **Build context**: leave default (Dokploy reads `build.context: ./backend` from the compose file).
4. Save — do **not** deploy yet. We need env vars first.

---

## 3. Configure env vars (Dokploy panel → Application → Environment)

All vars are referenced as `${VAR}` in the compose file. None must be committed to the repo.

| Variable | Notes |
|---|---|
| `POSTGRES_PASSWORD` | Strong random password, ≥24 chars. Same value used by `DATABASE_URL`. |
| `JWT_ACCESS_SECRET` | Random ≥32 chars (e.g. `openssl rand -hex 32`). |
| `JWT_REFRESH_SECRET` | Random ≥32 chars, different from access. |
| `MP_ACCESS_TOKEN` | MercadoPago **production** access token (not TEST-…). |
| `MP_PUBLIC_KEY` | MercadoPago **production** public key. |
| `MP_WEBHOOK_SECRET` | Configured in MP panel; copy here for HMAC validation. |
| `WHATSAPP_API_URL` | Tu backend WhatsApp (provider). |
| `WHATSAPP_API_TOKEN` | Token del provider. |
| `ADMIN_WHATSAPP_NUMBER` | E.164 sin `+`, ej. `5492914xxxxxxx`. |
| `EMAIL_FROM` | `prode@tirofederal.com` o el que aplique. |
| `RESEND_API_KEY` | Resend prod key (`re_...`). |
| `FRONTEND_URL` | `https://prode.tirofederal.com` (sin trailing slash). |
| `API_URL` | `https://api.prode.tirofederal.com` (sin trailing slash). |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret (server-side). |
| `SENTRY_DSN` | DSN del proyecto en Sentry (opcional pero recomendado). |
| `ADMIN_DEFAULT_DNI` | DNI del primer admin (7–9 dígitos). |
| `ADMIN_DEFAULT_PASSWORD` | Password del primer admin (≥8 chars). Cambiar tras login. |

> El seed (`seed-config.ts`) crea el admin solo en primer install. Una vez creado, podés vaciar `ADMIN_DEFAULT_*` o dejarlas — no se vuelven a usar.

---

## 4. Configurar dominio + HTTPS

En Dokploy → **Domains** del servicio `prode-backend`:

1. **Host**: `api.prode.tirofederal.com`.
2. **Container port**: `3001`.
3. **HTTPS**: ON. **Certificate provider**: Let's Encrypt.
4. **Force HTTPS redirect**: ON.
5. Save → Dokploy emitirá el certificado (Traefik lo gestiona automáticamente).

Verificación post-deploy:

```bash
curl -I https://api.prode.tirofederal.com/health
# HTTP/2 200
```

---

## 5. Primer deploy

1. Panel → **Deploy**. Dokploy hace `git pull`, `docker compose build`, `docker compose up -d`.
2. La primera vez, el contenedor `prode-backend` ejecuta `prisma migrate deploy` automáticamente en el entrypoint (`scripts/start.sh`). El log debe mostrar las migraciones aplicadas.
3. Si por algún motivo Dokploy no ejecuta el entrypoint o las migraciones fallan, podés correrlas manualmente:

   ```bash
   docker exec -it $(docker ps -qf name=prode-backend) npx prisma migrate deploy
   ```

4. Smoke test:

   ```bash
   curl -s https://api.prode.tirofederal.com/health
   # {"status":"ok","db":true,"timestamp":"..."}
   ```

5. Login del admin:

   ```bash
   curl -s -X POST https://api.prode.tirofederal.com/auth/login \
     -H 'content-type: application/json' \
     -d '{"dni":"<ADMIN_DEFAULT_DNI>","password":"<ADMIN_DEFAULT_PASSWORD>"}'
   # debe devolver { "accessToken": "...", "user": {...} }
   ```

---

## 6. Configurar webhook MercadoPago

Una vez que el dominio responde con HTTPS:

1. Panel MP → **Tu integración** → **Webhooks** → **Configurar notificaciones**.
2. URL: `https://api.prode.tirofederal.com/payments/webhook`.
3. Eventos: `payment` (acreditación de pagos).
4. Modo: **Producción**.
5. Guardar el **secret** que MP genera y pegarlo en `MP_WEBHOOK_SECRET` (Dokploy → Environment) → **Redeploy** del backend.

Verificación: hacer un pago de prueba (Sandbox o monto mínimo en prod) y revisar audit log:

```bash
docker exec -it $(docker ps -qf name=prode-postgres) \
  psql -U prode -d prode -c "select event_type, created_at from audit_log order by created_at desc limit 5;"
```

Debe aparecer un `PAYMENT_APPROVED` reciente.

---

## 7. Backups de Postgres → Backblaze B2

Dokploy soporta backups nativos S3-compatibles. Configurar en panel → **Database backups** del servicio `prode-postgres`:

1. **Provider**: Backblaze B2 (S3-compatible).
2. **Endpoint**: `s3.us-west-002.backblazeb2.com` (o el de tu bucket).
3. **Access Key ID** / **Secret Access Key**: Application Key con permisos sobre el bucket.
4. **Bucket**: `prode-backups` (crear primero en B2).
5. **Schedule**: cron `0 4 * * *` (4am ART = 7am UTC).
6. **Retention**: 30 días.

Verificación manual:

```bash
# Forzar un backup ahora desde el panel y confirmar que el archivo aparece en B2.
# Restore drill: descargar el último .sql.gz, lanzarlo en un postgres local con:
gunzip -c prode-YYYY-MM-DD.sql.gz | psql -U postgres -d prode_restore_test
```

---

## 8. Operación corriente

| Tarea | Comando / Acción |
|---|---|
| Ver logs en vivo | Dokploy → **Logs** del servicio, o `docker logs -f $(docker ps -qf name=prode-backend)` |
| Reiniciar backend | Dokploy → **Restart** (o `docker compose restart prode-backend`) |
| Aplicar migración manual | `docker exec -it $(docker ps -qf name=prode-backend) npx prisma migrate deploy` |
| Refrescar leaderboard | `curl -X POST https://api.prode.tirofederal.com/admin/leaderboard/refresh -H 'authorization: Bearer <token>'` |
| Rollback | Dokploy → **Deployments** → re-deploy del commit anterior. Si la nueva versión introdujo migración irreversible, restaurar backup primero. |

---

## 9. Notas finales

- **Single instance**: el stack está pensado para <200 usuarios. Para escalar horizontalmente habría que externalizar BullMQ/Redis y ajustar el rate limiter (ya usa Redis storage, así que es seguro multi-instance, pero el cron `@nestjs/schedule` debería migrarse a un solo "leader" o a BullMQ jobs repetibles).
- **TZ**: tanto Postgres como el contenedor backend usan `America/Argentina/Buenos_Aires`. La BD almacena UTC; el frontend convierte. El TZ del contenedor sólo afecta logs y crons.
- **Sentry**: si `SENTRY_DSN` está vacío, Sentry queda deshabilitado (log: `Sentry disabled`). En prod, configuralo siempre.
- **Secrets en logs**: el redactor de pino-http oculta `password`, `token`, `authorization`, `cookie` y los headers de MP — verificado en `src/common/observability/logger.spec.ts`.

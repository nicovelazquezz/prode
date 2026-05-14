# Deployment — Prode Mundial 2026

Manual runbook for deploying both the backend and the frontend to production via **Dokploy** on the Tiro Federal VPS. All commands assume the operator is logged into the Dokploy panel and has shell access to the host.

> The repo ships everything needed for a reproducible deploy: `backend/Dockerfile` (multi-stage, runs migrations on start) and `dokploy/docker-compose.yml` (postgres + redis + backend). Secrets and env vars live in the Dokploy panel — never in git.

---

## 1. Prerequisites

- VPS with Dokploy installed and Traefik running (Dokploy ships it).
- DNS: `api.prodeplus.com` → VPS public IP (A record).
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
| `EMAIL_FROM` | `noreply@prodeplus.com` o el que aplique. |
| `RESEND_API_KEY` | Resend prod key (`re_...`). |
| `FRONTEND_URL` | `https://prodeplus.com` (sin trailing slash). |
| `API_URL` | `https://api.prodeplus.com` (sin trailing slash). |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret (server-side). |
| `SENTRY_DSN` | DSN del proyecto en Sentry (opcional pero recomendado). |
| `ADMIN_DEFAULT_DNI` | DNI del primer admin (7–9 dígitos). |
| `ADMIN_DEFAULT_PASSWORD` | Password del primer admin (≥8 chars). Cambiar tras login. |

> El seed (`seed-config.ts`) crea el admin solo en primer install. Una vez creado, podés vaciar `ADMIN_DEFAULT_*` o dejarlas — no se vuelven a usar.

---

## 4. Configurar dominio + HTTPS

En Dokploy → **Domains** del servicio `prode-backend`:

1. **Host**: `api.prodeplus.com`.
2. **Container port**: `3001`.
3. **HTTPS**: ON. **Certificate provider**: Let's Encrypt.
4. **Force HTTPS redirect**: ON.
5. Save → Dokploy emitirá el certificado (Traefik lo gestiona automáticamente).

Verificación post-deploy:

```bash
curl -I https://api.prodeplus.com/health
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
   curl -s https://api.prodeplus.com/health
   # {"status":"ok","db":true,"timestamp":"..."}
   ```

5. Login del admin:

   ```bash
   curl -s -X POST https://api.prodeplus.com/auth/login \
     -H 'content-type: application/json' \
     -d '{"dni":"<ADMIN_DEFAULT_DNI>","password":"<ADMIN_DEFAULT_PASSWORD>"}'
   # debe devolver { "accessToken": "...", "user": {...} }
   ```

---

## 6. Configurar webhook MercadoPago

Una vez que el dominio responde con HTTPS:

1. Panel MP → **Tu integración** → **Webhooks** → **Configurar notificaciones**.
2. URL: `https://api.prodeplus.com/payments/webhook`.
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
| Refrescar leaderboard | `curl -X POST https://api.prodeplus.com/admin/leaderboard/refresh -H 'authorization: Bearer <token>'` |
| Rollback | Dokploy → **Deployments** → re-deploy del commit anterior. Si la nueva versión introdujo migración irreversible, restaurar backup primero. |

---

## 9. Notas finales

- **Single instance**: el stack está pensado para <200 usuarios. Para escalar horizontalmente habría que externalizar BullMQ/Redis y ajustar el rate limiter (ya usa Redis storage, así que es seguro multi-instance, pero el cron `@nestjs/schedule` debería migrarse a un solo "leader" o a BullMQ jobs repetibles).
- **TZ**: tanto Postgres como el contenedor backend usan `America/Argentina/Buenos_Aires`. La BD almacena UTC; el frontend convierte. El TZ del contenedor sólo afecta logs y crons.
- **Sentry**: si `SENTRY_DSN` está vacío, Sentry queda deshabilitado (log: `Sentry disabled`). En prod, configuralo siempre.
- **Secrets en logs**: el redactor de pino-http oculta `password`, `token`, `authorization`, `cookie` y los headers de MP — verificado en `src/common/observability/logger.spec.ts`.

---

# Frontend

El frontend es un servicio adicional dentro del mismo `dokploy/docker-compose.yml`. Se construye desde `./frontend/Dockerfile` (multi-stage, salida `standalone` de Next.js 15) y corre en el puerto 3000 detrás de Traefik con dominio propio.

## F1. Prerequisitos

- DNS: `prodeplus.com` → VPS public IP (A record).
- Backend ya desplegado y respondiendo en `https://api.prodeplus.com` (los pasos del backend deben completarse primero, sino la SSR falla en el primer render del SSR de algunas páginas).
- Acceso al panel Dokploy del proyecto `prode`.

## F2. Configurar env vars del frontend (Dokploy → Application → Environment)

El compose pasa estas variables como **build args** (Next inlinea cada `NEXT_PUBLIC_*` en el bundle del cliente al hacer `next build`) y también como variables de runtime (la capa SSR las consume en route handlers como `/api/health`). Por eso, **modificarlas requiere rebuild**, no solo restart.

| Variable | Valor producción | Notas |
|---|---|---|
| `API_URL` | `https://api.prodeplus.com` | Reusa la del backend; el compose la mapea a `NEXT_PUBLIC_API_URL`. |
| `FRONTEND_URL` | `https://prodeplus.com` | Reusa la del backend; mapeada a `NEXT_PUBLIC_FRONTEND_URL`. |
| `INSCRIPCION_PRECIO` | `15000` | Pesos argentinos. Si cambia, hay que rebuild + cambiar también la config de scoring en backend si aplica. |
| `ADMIN_WHATSAPP_NUMBER` | E.164 sin `+` (ej `5492914000000`) | Reusa la del backend; el frontend la usa para los CTAs `wa.me/...`. |
| `TURNSTILE_SITE_KEY` | Clave **pública** de Cloudflare Turnstile | Distinta de `TURNSTILE_SECRET_KEY` (esa es server-side, vive en backend). |
| `SENTRY_DSN_FRONTEND` | DSN del proyecto **frontend** en Sentry | Diferente del `SENTRY_DSN` backend. Dejar vacío deshabilita Sentry. |

> El compose hardcodea `NEXT_PUBLIC_WORLD_CUP_START=2026-06-11T18:00:00-03:00` y `NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT=false`. El mock checkout NO debe activarse en producción — está gateado por el backend, pero igual cerramos la puerta del lado cliente.

## F3. Configurar dominio + HTTPS

En Dokploy → **Domains** del servicio `prode-frontend`:

1. **Host**: `prodeplus.com`.
2. **Container port**: `3000`.
3. **HTTPS**: ON. **Certificate provider**: Let's Encrypt.
4. **Force HTTPS redirect**: ON.
5. Save → Dokploy emite el certificado vía Traefik automáticamente (puede tardar 30–60s la primera vez).

Verificación:

```bash
curl -I https://prodeplus.com
# HTTP/2 200
```

## F4. Primer deploy

1. Panel → **Deploy**. Dokploy hace `git pull`, `docker compose build` (incluye `prode-frontend` con todos los `--build-arg NEXT_PUBLIC_*`), y luego `docker compose up -d`.
2. El build del frontend tarda ~2 minutos (Next 15 + Webpack + Serwist + tipos). Si falla, revisar los logs del paso `build` — los errores comunes son `NEXT_PUBLIC_API_URL` ausente o lockfile fuera de sync.
3. Smoke test post-deploy:

   ```bash
   # Healthcheck del frontend (verifica que el SSR levantó y que puede llamar al backend)
   curl -s https://prodeplus.com/api/health
   # Expected: {"status":"ok","backend":true,"timestamp":"..."}

   # Landing accesible (debe devolver HTML con el countdown)
   curl -sI https://prodeplus.com/ | head -1
   # HTTP/2 200

   # Login del admin (mismo backend)
   curl -s -X POST https://api.prodeplus.com/auth/login \
     -H 'content-type: application/json' \
     -d '{"dni":"<ADMIN_DEFAULT_DNI>","password":"<ADMIN_DEFAULT_PASSWORD>"}'
   # debe devolver { "accessToken": "...", "user": {...} }
   ```

4. Probar en navegador: `https://prodeplus.com` debería cargar la landing y el countdown debe estar contando hacia el `WORLD_CUP_START`. Login del admin desde la UI.

## F5. PWA — instalación + service worker

Tras el primer deploy, el service worker (`public/sw.js`, generado por Serwist en build) se sirve con `Cache-Control: no-cache, no-store, must-revalidate` para que los updates lleguen inmediatamente. Verificar en DevTools → Application → Service Workers que aparezca registrado.

El manifest (`public/manifest.json`) y los iconos (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`) se sirven desde `public/`.

## F6. Activos pendientes (placeholders a reemplazar antes del lanzamiento público)

### F6.1. Tipografía display (FIFA WC 2026 Condensed)

El sistema visual usa `Fwc 2026 Condensed` como tipografía display, autohospedada en `frontend/public/fonts/`. Hoy ese directorio sólo tiene un `.gitkeep` — el frontend cae al fallback CSS hasta que se sume el archivo real.

**Procedimiento cuando el cliente entregue el `.woff2`:**

1. Copiar el archivo a `frontend/public/fonts/Fwc-2026-Condensed.woff2` (nombre exacto, lowercase).
2. Verificar que `app/layout.tsx` (o el `font-face` correspondiente en `app/globals.css`) ya referencia `/fonts/Fwc-2026-Condensed.woff2` con `font-display: swap`. No hace falta tocar Tailwind tokens.
3. Commit + push: el rebuild siguiente lo distribuye. **No hay env var ni redeploy especial**, alcanza con un deploy normal.
4. Smoke test: en DevTools → Network filtrar por `.woff2`, debe aparecer cargado con `200` y `Content-Type: font/woff2`.

### F6.2. Iconos PWA definitivos

Los iconos actuales en `frontend/public/icon-*.png` son **placeholders sólidos color azul** generados por `scripts/gen-pwa-icons.mjs` (sin texto, sin escudo del club). Antes del lanzamiento, el cliente debe entregar:

- `icon-192.png` — 192×192, fondo a sangre, escudo Tiro Federal centrado.
- `icon-512.png` — 512×512, idem.
- `icon-512-maskable.png` — 512×512 con safe area de 80px en cada borde para mascarillas Android.
- `apple-touch-icon.png` — 180×180, idem (sin transparencia, esquinas redondeadas las pone iOS).

**Procedimiento de reemplazo:**

1. Sobrescribir los 4 archivos en `frontend/public/` con los entregados.
2. (Opcional, recomendado) Subir un `screenshots/` con capturas para el manifest si se quiere mejorar la install card de Android.
3. Commit + redeploy.
4. **Importante:** los usuarios que ya tengan la PWA instalada **no verán el icono nuevo** hasta desinstalar/reinstalar — Android cachea el icono al momento del install prompt. Si se actualiza tras el lanzamiento, comunicar el reinstall.

## F7. Operación corriente (frontend)

| Tarea | Comando / Acción |
|---|---|
| Ver logs en vivo | Dokploy → **Logs** del servicio `prode-frontend`, o `docker logs -f $(docker ps -qf name=prode-frontend)` |
| Reiniciar frontend | Dokploy → **Restart** del servicio (no requiere rebuild) |
| Cambiar `NEXT_PUBLIC_*` | Editar env vars + **Redeploy** (rebuild necesario; restart no alcanza, los valores están inlined en el bundle) |
| Rollback | Dokploy → **Deployments** → re-deploy del commit anterior. El servicio backend no se ve afectado si solo cambia el frontend. |
| Forzar update del SW para todos los usuarios | El SW ya se sirve con `no-cache`, así que el browser revalida en cada visita. Si por algún motivo quedó cacheado, bumpear la versión en `app/sw.ts` y redeploy. |

## F8. Notas finales del frontend

- **Standalone output**: Next.js produce un `.next/standalone/server.js` autocontenido que NO necesita `next start` ni el módulo `next` instalado en runtime. El Dockerfile copia ese standalone + `.next/static` + `public/` y arranca con `node server.js`.
- **Build args vs env**: las variables `NEXT_PUBLIC_*` viajan por **ambas vías** (build args y runtime env). El motivo es que Next inlinea los valores en el bundle del cliente al build, pero algunos route handlers (ej `/api/health`) las consumen en runtime via `process.env`.
- **Cookies cross-subdomain**: el backend ya emite el refresh cookie con `Domain=.prodeplus.com` y `SameSite=Lax`. Eso permite que `prodeplus.com` y `api.prodeplus.com` compartan sesión sin trampolines de CORS.
- **Cloudflare Turnstile**: la `SITE_KEY` (pública) vive en el frontend, la `SECRET_KEY` (server-side) en el backend. Configurar el dominio `prodeplus.com` en el panel de Turnstile como hostname permitido.
- **Sentry**: si `SENTRY_DSN_FRONTEND` está vacío, el SDK queda no-op (ver `sentry.*.config.ts`). En prod, configuralo siempre — los errores SSR y de cliente caen al mismo proyecto Sentry.


## F9. Feature flag: `WA_MASS_NOTIFS_ENABLED`

Controla los envíos masivos automáticos de WhatsApp:

- **`false`** (default): se apagan el cron de recordatorios pre-partido (`MatchRemindersCron`) y el fan-out de "sumaste X pts en el partido" al cargar/recalcular un resultado (`ScoringService.finishMatchAndScore` y `recalculateMatch`). Esta es la configuración de producción porque el número del gateway Baileys es nuevo y sensible al rate-limit / shadowban de WhatsApp.
- **`true`**: comportamiento histórico — el cron encola recordatorios y el scoring encola un job por cada entry que sumó puntos.

**Cómo cambiarlo en prod (Dokploy)**:

1. Dokploy → Application `prode-backend` → **Environment**.
2. Setear `WA_MASS_NOTIFS_ENABLED=true` o `false` (string literal, no se admite `1`, `yes`, etc.).
3. **Redeploy** del servicio backend.

**Nota**: el WhatsApp automático al ganador de fase se eliminó de forma **permanente** (no gated por este flag). Si se quiere reactivar, hay que volver a agregar la línea en `phase.service.maybeClosePhase` con un spec nuevo. La `PhaseWinner` row se sigue creando para audit y cálculo de premios — solo la notificación WA está desactivada.

Ver spec en `docs/superpowers/specs/2026-05-14-wa-limit-mass-sends-design.md`.

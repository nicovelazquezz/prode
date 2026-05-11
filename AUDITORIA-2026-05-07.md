# Auditoría Prode Mundial 2026 — 2026-05-07

**Estado general:** Backend ~98% · Frontend ~92% · Admin ~85% · Infra deploy-ready, sin automatización · **35 días al kickoff**.

**Cambios desde la auditoría del 2026-05-06:**
- Cerrados los 6 quick-wins de Sprint 1 (A1, A2, A3, A4, A6, A9, B10).
- Cerrado Sprint 4 completo (manual payments + anular + métricas by-method).
- Cerrado Sprint 7 (admin partidos team picker, lista verificada).
- Cerrado Sprint 8.2 (WhatsApp share liga via `wa.me`), 8.3 (iOS install banner), 8.4 (global error boundary), 8.5 (countdown live especiales).
- Cerrado Sprint 2.3 (tests backend + e2e del flow `/perfil`).

**Health checks de hoy:**
- Backend build ✅ · Backend typecheck ✅ · Backend lint ✅
- Backend tests: 405/407 ✅ (2 fails preexistentes en `notifications.integration.spec.ts` — retry → FAILED, no es regresión)
- Frontend build ✅ · Frontend typecheck ✅ · Frontend tests: 164/164 ✅
- **Frontend lint: 25 errors, 104 warnings** ⚠ (React Compiler stricter rules)

---

## 1. CRITICAL — Bloquea producción

### C1. No existe endpoint para puntuar pronósticos especiales
- **Qué falta**: `PUT /admin/tournament-results` (o equivalente) para que admin cargue campeón / subcampeón / 3° / goleador / total de goles oficial cuando termine el torneo, y un servicio que recorra todos los `SpecialPrediction` y popule `championPoints`, `runnerUpPoints`, etc.
- **Estado actual**: el schema tiene los campos (`SpecialPrediction.championPoints` y derivados) pero **no hay servicio ni controlador** que los compute. `modules/scoring/` no expone `scoreSpecialPredictions()`.
- **Impacto**: terminar la final = los specials nunca se puntúan = leaderboard final desfasado del prize pool prometido. **Reembolsos / disputas / reputación.**
- **Estimación**: ~1 día (endpoint + service + audit + tests).

### C2. `Date.now()` impuro en render de `/predicciones/[matchId]`
- **Archivo**: `frontend/app/(app)/predicciones/[matchId]/page.tsx:173`.
- **Problema**: el cómputo de `isLocked` lee `Date.now()` durante el render. React Compiler lo detecta como impure → puede flipear entre renders bajo Suspense / batching de React 19.
- **Fix**: derivar `isLocked` del estado del backend (`match.status` ya cubre `LOCKED|IN_PROGRESS|POSTPONED|CANCELLED`); el chequeo client-side por `predictionsLockAt` ya está en el countdown timer y debería resolverse en el `MatchCard` con su propio interval, no en render-phase.
- **Estimación**: 15 min.

---

## 2. HIGH — Fix corto, alto retorno

### H3. Dev .env tiene flags peligrosas que NO pueden ir a prod
Archivo `backend/.env` (gitignored, no commiteado, pero usado para dev local):
- `THROTTLER_BYPASS_TEST=1` → **deshabilita TODO rate limit** (login, recovery, payments).
- `JWT_ACCESS_SECRET=dev_only_access_secret_at_least_32_chars_long_xxx`
- `JWT_REFRESH_SECRET=dev_only_refresh_secret_at_least_32_chars_long_xxx`
- `ADMIN_DEFAULT_PASSWORD=ChangeMe_DevOnly!`

**Riesgo**: el operador clona `.env` a Dokploy "para arrancar rápido". Bypass activo en prod = brute force libre, JWT forjable, admin tomable.

**Fix**: en `config/env.ts` agregar hard-guard que **falla el bootstrap** si en `NODE_ENV=production`:
- `THROTTLER_BYPASS_TEST` está definida
- secretos contienen sustrings: `dev_only`, `ChangeMe`, `test-secret`, `your-secret-here`
- `ADMIN_DEFAULT_PASSWORD === 'ChangeMe_DevOnly!'` (default literal)

**Estimación**: 30 min.

### H4. DNI guardado en plaintext en `audit_logs`
- `backend/src/modules/admin/admin-entries.controller.ts:225` → `targetUserDni: entry.user.dni`
- `backend/src/modules/admin/admin-payments.controller.ts:322` → `targetUserDni: user.dni`
- **Existe** `maskDni()` en `auth.controller.ts:127` (formato `12***678`), pero no se usa acá.

**Riesgo**: backup leak / acceso de admin malicioso → harvest de 500 DNIs reales.

**Fix**: importar `maskDni` y aplicarlo en los dos puntos. **Estimación: 10 min.**

### H5. CSRF no protegido para cookie-based refresh
- `auth.controller.ts:68-87` sets refresh token cookie con `httpOnly: true, sameSite: 'lax'`. Lax permite top-level navigation/form posts cross-origin → un atacante puede hacer logout o refresh del user vía formulario oculto.
- **Mitigaciones presentes**: el access token usa `Authorization: Bearer` (CSRF-proof). Solo el refresh y el logout son cookie-based.

**Fix opciones**:
- Agregar header `X-CSRF-Token` validado en `/auth/refresh` y `/auth/logout` (double-submit cookie pattern).
- O cambiar a `sameSite: 'strict'` (requiere que frontend y backend compartan dominio, lo cual ya planeás en Dokploy).

**Estimación**: 1h con `strict` (testear en prod-like setup), 3h con CSRF token full.

### H6. `/auth/login` solo limita por IP, no por DNI
- Throttler config (`common/throttler/`) usa default IP-only.
- **Vector**: atacante con muchas IPs (botnet, residential proxies) hace brute force contra un DNI concreto sin disparar el límite.
- **Fix**: implementar `getTracker` custom que combine `${ip}:${dni}` extraído del body. NestJS Throttler v5+ lo soporta.
- **Estimación**: 1h + tests.

---

## 3. MEDIUM — Fix antes de scale-out, no urgente para single-instance

### M7. Crons no son multi-instance safe
- Sin distributed locking (Redis SET NX). Si Dokploy escala backend a 2+ replicas, todos los crons (`PaymentsCron`, `MatchesCron`, `OutboxSafetyNetCron`, etc.) disparan en cada instance simultáneamente.
- **Hoy**: deployás single-instance ⇒ no es un bug activo, es una limitación documentada.
- **Fix futuro**: `redlock` o un patrón `SET NX EX 60` antes de cada cron body.
- **Workaround corto**: variable `ENABLE_CRONS=true` en una sola instance, `false` en las otras. **5 min agregar el flag.**

### M8. Webhook MercadoPago: sin replay protection ni idempotency check
- `mercadopago.provider.ts:151-199` valida HMAC pero no verifica que el `ts` del header sea reciente.
- `payments.controller.ts:76-88` extrae `request-id` para HMAC pero **no chequea** que ese ID ya fue procesado.
- **Riesgo**: webhook capturado meses atrás replicado, o retry de MP duplicado → doble entry/refund.
- **Fix**:
  - Reject si `Date.now() / 1000 - ts > 300` (5 min window).
  - Cache `request-id` en Redis (TTL 24h) y skip si existe.
- **Estimación**: 1h.

### M9. `recalculateMatch` no re-chequea `status='FINISHED'` adentro del TX
- `scoring.service.ts:233`: `prediction.updateMany` no filtra por estado del match.
- **Race**: dos admins editan score del mismo match en simultáneo → last-write-wins silencioso, sin alerta.
- **Probabilidad**: muy baja (1 admin operativo + acción rara).
- **Fix**: agregar `match: { status: 'FINISHED' }` al where de `updateMany`.
- **Estimación**: 5 min + test de race.

### M10. `RolesGuard` no es global
- Cada controller admin debe acordarse de `@UseGuards(RolesGuard) @Roles('ADMIN')`. Olvidarlo en un endpoint nuevo = lo expone a cualquier usuario autenticado.
- **Hoy**: todos los controllers actuales lo tienen wired. Es un riesgo de futuro, no presente.
- **Fix**: registrar `RolesGuard` global en `app.module.ts` con `APP_GUARD`, hacer que `@Roles()` por defecto sea `['ADMIN', 'USER']` y que `@Public()` lo bypassee.
- **Estimación**: 1h.

### M11. Frontend lint: 25 errors del React Compiler
**Reales** (perf / correctness):
- `predicciones/[matchId]:173` — `Date.now()` en render (ver C2, mismo bug, criticidad mayor).
- `inscripcion/page.tsx:31` — `setState` antes de `await initPayment`. Refactor: inicializar state al nivel del componente, no en effect.
- `admin/pagos:538, 821` — modales con resets de state en effect cuando `!open`. Refactor: lift the reset al parent o usar `useLayoutEffect`.

**Falsos positivos del Compiler** (patrones benignos: form-sync de prop, hidratación de localStorage):
- `ligas/unirme:102`, `entry-switcher:267`, `mock-checkout:68` (esta es dev-only y no embarca a prod)
- Resto de los `setState in effect`: ~5 archivos.
- **Acción**: suprimirlos con `// eslint-disable-next-line react-compiler/react-compiler` y un comment del por qué.

**Cosmético**:
- `ios-install-banner.tsx:149` — comillas no escapadas → reemplazar por `&quot;`.
- `'this' aliasing` en `:1:3938` → vendor minificado, agregar `node_modules` al lint ignore.

**Estimación total frontend lint**: 1.5h.

### M12. CI/CD inexistente
- `.github/workflows/` no existe.
- Sin pre-commit hooks (no `.husky/`, no `lint-staged`).
- **Riesgo top-3 del audit anterior**: migración rota → deploy roto sin red de seguridad.
- **Mínimo aceptable**: workflow que corra `npm test` + `npm run build` en cada push a `main`.
- **Estimación**: 1.5h para un workflow básico (backend + frontend).

---

## 4. LOW — Polish / hardening

| # | Item | Acción |
|---|---|---|
| L13 | `notifications.integration.spec.ts` flake (2 fails sobre retry → FAILED) | Investigar si depende de Redis/timing. No bloquea — pero rompe confianza en CI verde. |
| L14 | B2 backup setup no documentado (credenciales en host, no container) | Agregar `docs/dokploy-deploy.md` con runbook paso a paso. |
| L15 | Redis sin healthcheck en `dokploy/docker-compose.yml` | Agregar `healthcheck: redis-cli ping`, cambiar backend a `service_healthy`. |
| L16 | Redis 6379 expuesto al host en dev compose | Quitar `ports` en prod compose (solo red interna). |
| L17 | `/users/:id/public-profile` sin paginación de entries/predictions | Limitar a top-20 entries y top-50 predictions; theoretical DoS. |
| L18 | Password reset por DNI: 3/h por IP es generoso para enumeración | Bajar a 3/15min o agregar respuesta neutra "te enviamos si existe la cuenta". |
| L19 | Pino redact list no incluye `dni` | Agregar `req.body.dni`, `*.dni` al censor de Pino. |
| L20 | `/admin/notifications/{direct,broadcast,history}` (B11-B13) sin backend | Solo si Sprint 3 (WA real) lo va a usar; sino dejar UI hidden. |
| L21 | `/admin/phases` y `/admin/prizes` (B14-B16) sin backend | Si manejás premios manualmente afuera, baja prioridad. |
| L22 | Exports CSV/PDF (B17-B18) sin backend | Para reportar al club post-Mundial. Baja prioridad. |
| L23 | Email real (Resend) integration stub | Si vas solo-WhatsApp, limpiar UI; si querés email para reset password como respaldo, ~4h. |
| L24 | Auto-progresión R32 sigue manual (decisión D) | Documentar SOP del admin la noche del cierre de fase de grupos. |
| L25 | Real-time leaderboard solo polling 30s | Para 500+ users concurrentes. SSE opcional post-launch. |

---

## 5. Decisiones de negocio aún sin cerrar (heredadas del audit anterior)

1. **Pagos pendientes >24h**: ¿qué hace el cron `orphan-alert.processor`? ¿WhatsApp al user? ¿Notifica admin? — relevante una vez que tengamos WA real.
2. **Múltiples links de pago concurrentes** del mismo user: el primero gana el token, los otros 404. **No hay UX** "ya tenés un pago pendiente".
3. **Multi-prode + premios**: ¿un user con 3 entries puede ganar 3 veces? Schema lo permite. Reglamento debería decirlo.
4. **Premios CBU**: el schema no tiene `cbu` en User. Cuando el ganador cobre, ¿se pide por WhatsApp manual, o agregamos campo?
5. **Reprogramaciones**: si admin postpone un match, ¿se manda WhatsApp "el partido se reprogramó"? — relevante con WA real.

---

## 6. Punchlist priorizado para "todo OK + WhatsApp + prod"

### Bloque A — Bloqueo prod (estimado: ~1.5 días)
1. **C1** — Endpoint scoring de pronósticos especiales (~1 día).
2. **C2** — Fix `Date.now()` en `/predicciones/[matchId]` (~15 min).
3. **H3** — Hard-guard de secrets dev en `NODE_ENV=production` (~30 min).
4. **H4** — Aplicar `maskDni()` en audit logs (~10 min).
5. **H5** — CSRF: cambiar a `sameSite: 'strict'` o agregar token (~1-3h).
6. **H6** — Per-DNI rate limit en login (~1h).

### Bloque B — Hardening previo a WA (estimado: ~1 día)
7. **M8** — Webhook replay protection + idempotency (~1h).
8. **M9** — `recalculateMatch` race fix (~5 min).
9. **M11** — Frontend lint cleanup (los reales) (~1h).
10. **L15+L16** — Redis healthcheck + ports cleanup (~10 min).
11. **L19** — Pino redact `dni` (~5 min).
12. **M12** — GitHub Action básico (lint + test + build) (~1.5h).

### Bloque C — WhatsApp (estimado: 1-2 días)
13. Sidecar Baileys según el brief acordado.
14. Backend: aplicar `maskDni` también al WhatsApp dispatch.
15. Decidir las 5 reglas de negocio (orphan, pendings, CBU, premios multi, reprogramación).

### Bloque D — Post-launch (no bloqueante)
- M7 (distributed cron lock), M10 (RolesGuard global), L13-L25.

**Total estimado bloque A + B + C: ~4 días de trabajo enfocado.**

---

## 7. Confianza de este audit

- **Alta** para domain logic (3 agentes Explore + verificación grep en archivos citados).
- **Alta** para security posture (.env y código fuente verificados línea a línea).
- **Alta** para operational readiness (Dockerfiles + compose + crons inspeccionados).
- **Alta** para frontend lint (lista exacta de archivos y líneas).
- **Media** para infra (no probé deploy en Dokploy en vivo; descansa en lo que el repo dice).

**Última actualización: 2026-05-07 11:30 ART** — sucesor del audit del 2026-05-06.

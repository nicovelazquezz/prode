# Auditoría Prode Mundial 2026 — 2026-05-06

**Estado general:** Backend ~95% · Frontend ~80% · Admin ~50% · Infra deploy-ready sin automatización · **36 días hasta el kickoff**.

> Plan original `01-plan-desarrollo.md` apuntaba al MVP **45 días antes** (≈ 2026-04-28). Hoy estamos 8 días después de ese deadline. La parte central (registro → pago → predicción → puntos → ranking) está OK; lo que faltaría se concentra en **wire-up admin operacional**, **endpoints backend menores** y **endurecimiento de prod**.

---

## 1. Listo (DONE)

### Backend (12 módulos · 46 spec files)
| Módulo | Endpoints | Tests | Estado |
|---|---|---|---|
| auth | login · /me · refresh · logout · forgot/reset · change-password · complete-registration | 4 | ✅ |
| matches | list · upcoming · by-phase · detail · admin update · postpone | 3 | ✅ |
| predictions | upsert match · get entry · special · count público | 7 | ✅ |
| scoring | finishMatchAndScore · recalculateMatch · phase closeout · multipliers | 6 | ✅ |
| leaderboard | global · phase · entry-around · league · refresh job | 6 | ✅ |
| leagues | create · my · join (invite code) · league leaderboard | 4 | ✅ |
| payments | MP init · webhook · token magic-link · orphan alerts | 5 | ✅ |
| notifications **(workers/crons)** | send + 4 processors (match-result, phase-winner, reminders) + outbox | 7 | ✅ |
| audit | log action/entity/changes con user+IP+UA | 1 | ✅ |
| stats | enrolled · pozo público | 1 | ✅ |
| dev | simulate-webhook (excluido en prod) | 1 | ✅ |
| users | public-profile (cached 60s) · `updateUser` · `resetUserPassword` admin | 1 | ✅ |

**Schema:** 20 entidades · 5 migraciones (multi-prode m1+m2 + shirt-number).
**Seeds:** teams (48) · matches (104) · players (1622) · config · dev-users.
**Wiring:** main.ts con Sentry pre-import, Pino, graceful shutdown · global pipes/guards/interceptors/filters · DevModule excluido en prod.

### Frontend (rutas)
- **(public)** 11/11: landing · login · inscripción (+ success/pending/failure) · completar-registro · forgot/reset password · reglamento.
- **(app)** 8/8: predicciones (lista + detalle) · especiales · leaderboard (+ por liga) · ligas (lista + crear + unirme) · perfil.
- **(admin)** 10/10 *con stubs en algunas mutations* (ver §2).

**Componentes:** 13 landing · 34 domain (14 con tests) · 6 layout (4 con tests) · 10 ui primitives.
**Tests:** 164 unit · 7 e2e Playwright.
**Estética:** Editorial Scoreboard v4 ya aplicada en `/predicciones` (lista + detalle). Match card con 8 tratamientos visuales notorios (+ 4 sub-estados de finished: exact / winner-diff / winner-only / miss).

### Infra
- Docker Compose dev + Dokploy prod compose listos.
- Dockerfiles backend+frontend multi-stage, healthchecks, non-root, lean.
- Backend `start.sh` corre `prisma migrate deploy` antes del bootstrap.

---

## 2. WIRE-UP GAPS (verificados con grep en el repo)

> Sección reescrita el 2026-05-06 después de auditoría línea-a-línea.
> Distingo **3 categorías** según el costo real de cerrar el gap.

### A. Backend YA EXISTE — frontend solo necesita wire-up (~5–30 min c/u)

| # | Backend disponible | Estado frontend | Gap |
|---|---|---|---|
| **A1** | `PATCH /admin/users/:id` (status: ACTIVE/INACTIVE/BANNED) | `lib/api/admin.ts:49 updateUser()` exportada · `/admin/usuarios/page.tsx:339` hace `toast.info("proximamente")` | Menu Desactivar/Banear/Reactivar **no muta** |
| **A2** | `POST /admin/users/:id/reset-password` | `lib/api/admin.ts:67 resetUserPassword()` exportada · mismo menu stub | Item "Reset password" **no genera password** |
| **A3** | `PATCH /entries/:id` (rename alias) | `lib/api/entries.ts:28 updateEntryAlias()` exportada · **0 referencias** en app/ y components/ | El user crea entries con alias pero **no puede editarlo después**. EntrySwitcher no expone "Renombrar" |
| **A4** | `POST /admin/leaderboard/refresh` | `lib/api/admin.ts:243 refreshLeaderboard()` exportada · **0 referencias** en UI | Si admin cambia scoring rules, **necesita SSH+SQL** |
| **A6** | `GET /admin/metrics` (T10) | Ya wired en dashboard pero queda TODO + banner "endpoint no disponible — mostrando ceros" como dead code | Solo cosmético: limpiar el banner stale |
| **A9** | `AppConfig.max_users` (T5) | 0 visibility en UI | Dashboard no muestra "X / 500 inscriptos" — admin no se entera del cap salvo por 409 |

**Sumatoria: ~1.5 horas de frontend para cerrar A1–A9.** Todo es agregar `useMutation` + `onClick` + invalidación de query.

### B. Backend NO EXISTE — frontend tiene UI lista pero apunta al vacío

| # | Frontend llama | Backend | Página afectada |
|---|---|---|---|
| **B10** | `PATCH /users/me` (whatsapp + opt-in) | ❌ users module sin `@Patch`/`@Put` | `/perfil` line 203 hace `toast.success("mock — backend pendiente")`. Form **funcional pero NO persiste** |
| **B11** | `POST /admin/notifications/direct` | ❌ notifications module sin controller | `/admin/notificaciones` tab "Mensaje directo" — 100% sin backend |
| **B12** | `POST /admin/notifications/broadcast` | ❌ idem | mismo, tab "Difusión" |
| **B13** | `GET /admin/notifications` (history) | ❌ idem | mismo, tab "Historial" |
| **B14** | `GET /admin/phases/summary` | ❌ no existe | `/admin/fases` — página existe pero **no carga datos reales** |
| **B15** | `GET /admin/prizes` | ❌ no existe | mismo, tabla de premios queda vacía |
| **B16** | `POST /admin/prizes/:id/pay` | ❌ no existe | mismo, botón "Marcar pagado" no funciona |
| **B17** | `GET /admin/exports/payments.csv` | ❌ no existe | botón Export en dashboard tira **404** |
| **B18** | `GET /admin/exports/leaderboard.pdf` | ❌ no existe | mismo |

**Sumatoria estimada de backend nuevo:**
- B10 (`PATCH /users/me`): ~20 min — endpoint trivial.
- B11–B13 (admin notifications, 3 endpoints): ~1.5 días — reusa `NotificationsService.enqueue` que ya existe.
- B14–B16 (admin phases/prizes, 3–4 endpoints): ~1.5 días — necesita modelo `PhaseWinner` consults + nuevo `Prize` flow.
- B17–B18 (exports): ~1 día — CSV trivial, PDF si no querés depender de un service externo es ~4-6h con `pdfkit`.

**Total backend faltante: ~4 días de trabajo.**

### C. Otros findings menores

| # | Detalle |
|---|---|
| C19 | `app/(admin)/admin/configuracion/page.tsx`: tenía `defaultSpecialRules()` con keys UPPER_SNAKE_CASE inventadas. **Resuelto en T14** |
| C20 | `app/(admin)/admin/partidos/[id]/page.tsx:567`: TODO sobre fase pagada (premio entregado) — depende de B16 |
| C21 | `app/layout.tsx:30, 68`: TODOs de fonts custom (FWC2026 woff2) y reemplazar PNGs placeholder. Cosmético |

---

## 3. Backend con tests faltantes (no bloqueante para lanzar, sí para confiar en cambios)

- **entries** (multi-prode): 0 specs. La cap `max_entries_per_user` y el `SELECT FOR UPDATE` del init-payment no tienen test.
- **admin** controllers: 0 specs.
- **players** controller: 0 specs.

---

## 4. Datos del torneo

- **72 partidos de grupos** scrapeados con teams populados (México, Sudáfrica, etc., flagUrl flashscore PNG).
- **32 partidos de knockout = placeholders** (homeTeamId / awayTeamId null, labels tipo "1A", "2B"). El TODO está en `match-progression.service` línea 55: la lógica para auto-poblar Round 32 desde resultados de grupos (incluye regla 8-best-thirds) está pendiente.
- **1622 jugadores seedeados** ya en BD con shirtNumber.

---

## 5. Frontend polish (cosmético, no bloqueante)

- Font `FWC2026-CondensedBlack.woff2` (propietaria FIFA) referenciada pero ausente — fallback Anton + Arial Narrow Black activo.
- Favicons placeholder (cuadrados sólidos), no finales.
- `global-error.tsx` existe pero está vacío — no hay error boundary global.
- Service worker `sw.ts` mínimo; no hay offline mode real más allá del manifest.

---

## 6. Operacional / lanzamiento (gaps de infra)

- **CI/CD**: cero. No hay `.github/workflows/`. **Riesgo alto** dado el deadline.
- **Backups automáticos**: 1 dump manual en `/backups`. Dokploy menciona Backblaze B2 pero no está configurado. Sin schedule, sin retention, sin restore drill.
- **Monitoring/alerting**: `SENTRY_DSN` está como env var pero no hay reglas de alerta, no hay log aggregation, no hay paging on-call.
- **Reverse proxy / TLS**: no hay config en el repo. Asume que Dokploy lo provee.
- **Rate limiting**: spec lo describe pero `@nestjs/throttler` no está verificado en el código (sí hay rate limit en payments/init).
- **Email real**: `RESEND_API_KEY` env var existe pero la integración con Resend está stub.
- **WhatsApp real**: `WHATSAPP_API_URL` configurable pero la integración real con `whatsapp-web.js` no está mockeada en tests ni verificada en prod.
- **Real-time leaderboard**: solo polling 30s. Para 500+ users concurrentes podría sentirse lento.

---

## 7. Casos para resolver (decisiones de negocio)

1. **Pagos pendientes >24h**: el cron `orphan-alert.processor` se dispara, pero **¿qué hace?** ¿Manda WhatsApp al user con nuevo link? ¿Notifica al admin? La SOP no está documentada.

2. **Múltiples links de pago concurrentes**: si un user inicia 2 pagos a la vez, tiene 2 `Payment` rows. El primero gana el `completionTokenHash`, los otros tiran 404. **No hay UX** "ya tenés un pago pendiente".

3. **Multi-prode + premios**: si un user compra 5 entries, ¿los 5 entran al ranking global por separado? El schema dice que sí. Pero el pozo es global. **¿Solo cuenta el #1 del user, o pueden ganar con varios?**

4. **Multiplicador por fase**: `PhaseMultiplier.multiplier` es `Decimal(3,1)`. Si cambiás un multiplier después de partidos jugados, **¿se recalcula retroactivamente?** El servicio tiene `recalculateMatch` pero no está claro si refresca todos los entries de la fase.

5. **Tipo de outcome `DRAW_DIFFERENT`**: el frontend lo muestra como "✓ EMPATE" con tier "winner-only" (+2 pts). **¿La regla oficial coincide?** Vale revisar `seed-config.ts`.

6. **Auto-poblar Round 32**: TODO en `match-progression.service:55`. Regla 8-best-thirds requiere ranking inter-grupos. **¿Implementar o resolución manual la noche del último match de grupos?**

7. **Especiales locked date**: el alert dice "no podrás modificarlas después del 11/06" — ¿hora exacta? Probable: `kickoffAt - 10min` del primer match, pero no está confirmado en el frontend.

8. **Cambio de horario de un match**: cuando admin postpone, el `predictionsLockAt` se recalcula. ¿Mandamos WhatsApp "el partido se reprogramó, podés editar tu prediction"?

---

## 8. Dudas sin resolver (necesito tu input)

1. **¿Quién opera el día D?** Si vos sos único admin, ¿estás disponible 11/06 desde las 18:00 ART para resolver issues en vivo? Si no, runbooks o segundo admin.

2. **Backups y restore drill**: nunca se probó un restore. RPO/RTO no definidos. Recomiendo 1 drill antes del torneo.

3. **Carga real esperada**: ¿cuántos users planeás? Para 50-200 está sobrado. Para 1000-5000 hay que estresar el leaderboard y el webhook MP en pico.

4. **¿El scraper corre por cron?** Si FIFA mueve un kickoff o un venue, ¿quién/cuándo se entera el sistema?

5. **Premios: cómo se entregan**. El admin tiene endpoint `markPaid` (B16, NO existe todavía). Pero **¿hay que pedirle CBU al ganador?** No vi un campo `cbu` en User ni un flow para pedirlo.

6. **Liga vs Entry**: si yo tengo 3 entries y todos en una liga, **¿aparezco 3 veces en el ranking?** Default del schema sugiere que sí. **¿Lo querés así?**

7. **Estética del admin**: la landing es el mantra del frontend, pero el admin no se migró. **¿Lo migramos?** Si solo vos vas a usar admin, baja prioridad.

---

## 9. Plan de prioridades para los próximos 36 días

### SPRINT 1 — Quick wins de wire-up (semana 1, ~3h totales)
**Pura UI, backend ya existe:**
- [ ] **A1+A2** → `/admin/usuarios` actions menu funcional (`updateUser` + `resetUserPassword`). ~30 min
- [ ] **A3** → EntrySwitcher con "Renombrar entry" inline. ~30 min
- [ ] **A4** → botón "Refrescar leaderboard" en dashboard admin. ~10 min
- [ ] **A6** → cleanup del TODO + banner stale en dashboard. ~5 min
- [ ] **A9** → widget "X / Y inscriptos" en dashboard usando `AppConfig.max_users` + `stats.enrolled`. ~15 min
- [ ] **B10** → endpoint `PATCH /users/me` backend (~20 min) + wire `/perfil` form (~10 min). ~30 min

**Pasamos de "Admin ~50%" a "Admin ~75%" con esto.**

### SPRINT 2 — Operacional crítico (semana 1–2)
- [ ] **CI/CD básico**: GH Actions con `npm test` + build en PR. **1 día**
- [ ] **Restore drill de BD**: simular crash, restaurar desde Dokploy/B2, documentar tiempo. **0.5 día**
- [ ] **B14–B16** → admin phases + prizes (modelo + endpoints + wire UI). **1.5 días**
- [ ] **Decisión + implementación R32 auto-progresión** (o documentar SOP manual). **1 día**

### SPRINT 3 — Backend nuevo no crítico (semana 3)
- [ ] **B11–B13** → admin notifications direct/broadcast/history. **1.5 días**
- [ ] **B17–B18** → exports CSV/PDF. **1 día**
- [ ] **Email real** (Resend) o decidir solo-WhatsApp y limpiar UI. **0.5 día**

### SPRINT 4 — Endurecimiento (semana 4)
- [ ] Tests faltantes (entries, admin controllers, players). **1 día**
- [ ] Rate limiting global (`@nestjs/throttler`). **0.5 día**
- [ ] CORS/CSP backend revisión. **0.5 día**
- [ ] Backup automático configurado en Dokploy. **0.5 día**
- [ ] Sentry alerting rules. **0.5 día**
- [ ] **CBU en User + flow de premio** (cuando corresponda). **0.5 día**

### Buffer (semanas 5–6)
- Beta testing con 5-10 users del club.
- Bug fixes.
- Migración admin a estética landing si querés delegar.
- PWA / offline / SSE si hay tiempo.

---

## 10. Riesgos top 3 si no se hace nada

1. **Admin operacional bloqueado el día D** — un user paga por transferencia, admin no puede marcarlo manualmente porque A1+A2 no están wireados. **Riesgo más grande.**
2. **Migración rota → deploy roto** — sin CI, una migración que falla en prod tira el sistema. Posible la noche antes del torneo.
3. **Sin backup automático → pérdida de datos** — un crash + sin backup reciente = pierdes todas las predicciones cargadas.

---

## 11. Confianza de este audit

- **Alta** para backend (revisión endpoint por endpoint via grep + listing de controllers).
- **Alta** para frontend wire-up (verificación línea-por-línea de la sección §2 con grep en el repo el 2026-05-06).
- **Media** para infra (no probé el deploy en Dokploy en vivo).
- **Baja** para "lo que falta operacional" (depende de cuánto tiempo tenés vos para operar manualmente vs automatizar).

**Última actualización: 2026-05-06 14:55 ART** — integrada la auditoría de wire-up del usuario (sección §2 reescrita).

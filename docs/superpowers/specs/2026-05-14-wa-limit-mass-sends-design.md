# WhatsApp: apagar envíos masivos automáticos

Date: 2026-05-14
Status: pending user review (spec review loop completed)

## Context

El gateway `wa-backend` (Baileys) usa un número de WhatsApp **nuevo**.
Los números nuevos son mucho más sensibles al rate-limit / shadowban de
WhatsApp que un número con historia. Cualquier ráfaga sostenida puede
activar bloqueo, lo que tiraría abajo todo el canal — incluyendo
flujos críticos como recuperar contraseña, alertas al admin y el botón
manual de "avisar al pago pendiente".

Hoy hay **dos fuentes de envíos masivos automáticos** que en un día
ocupado del Mundial pueden disparar miles de mensajes:

- **Recordatorios pre-partido** (`MatchRemindersCron`, cada 15 min):
  para cada `SCHEDULED` que kickea en próximas 2hs, manda un WA a cada
  user `ACTIVE + whatsappOptIn` que no cargó predicción. Worst case con
  500 users y 4 partidos en el día: ~2.000 mensajes por día.

- **Fan-out "Sumaste X pts en el partido"** (`MatchResultProcessor`,
  disparado por `scoring.service.finishMatchAndScore` y
  `recalculateMatch`): al cargar el resultado, manda un WA a cada
  entry que sumó puntos. Worst case: ~400 mensajes en ráfaga (mismo
  segundo) por cada partido cargado.

Además, al cerrar una fase (`phase.service.maybeClosePhase`) se encola
`PHASE_WINNER_JOB` que manda un WA automático al ganador calculado.
Es un solo mensaje por fase, pero el admin prefiere contactar a los
ganadores manualmente (los premios se pagan offline; vos decidís a
quién y cuándo).

## Decisiones (cerradas en brainstorming)

- **No habrá envíos masivos automáticos**. Se apagan recordatorios
  pre-partido y fan-out "sumaste X pts" detrás de un feature flag.
- **No habrá WhatsApp automático al ganador de fase**. El admin
  contacta a los 2 ganadores (fase de grupos + fase de eliminación
  según el uso operativo) desde su WhatsApp personal.
- **No se construye ninguna UI nueva**. El botón "Avisar por WhatsApp"
  para pagos pendientes ya existe en `/admin/pagos`. El admin 1-a-1
  desde `/admin/notificaciones` ya cubre el resto.
- **No se desactiva email**. No se usa hoy y se deja como estaba — fuera
  de scope.
- **No se cambia el modelo de fases premiables**. Las 7 fases del enum
  siguen como están; el admin decide operativamente cuáles premiar.

## Cambios

### 1. Feature flag `WA_MASS_NOTIFS_ENABLED`

Nueva variable de entorno booleana, parseada en
`backend/src/config/env.ts`. Default: **`false`**.

**Parser**: `env.ts` hoy no tiene ninguna env booleana (solo strings,
números coercionados, enums). `z.coerce.boolean()` es trampa porque
trata cualquier string no vacío como `true` (incluido `"false"`).
Definir el campo como:

```ts
WA_MASS_NOTIFS_ENABLED: z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true'),
```

Esto deja el tipo inferido como `boolean` y rechaza valores que no sean
exactamente `"true"` o `"false"`, evitando ambigüedad.

Cuando es `false`:

- `MatchRemindersCron.sendReminders()` hace early return después del
  log de entrada, sin tocar la query de matches ni encolar nada.
  El cron sigue corriendo (no se desactiva el `@Cron`), solo no produce
  trabajo. El cron ya lee `loadEnv()` en el constructor, así que el
  guard es `if (!this.env.WA_MASS_NOTIFS_ENABLED) return 0;`.
- `scoring.service.finishMatchAndScore()` y `recalculateMatch()` saltean
  la línea `notificationsQueue.add(MATCH_RESULT_JOB, { matchId })`.
  El resto del side-effect (refresh de leaderboard MV,
  `maybeClosePhase`, audit log) se ejecuta normalmente.

  **Dónde lee el flag `scoring.service`**: hoy no inyecta env de
  ninguna forma. Se sigue el mismo patrón del cron — invocar
  `loadEnv()` en el constructor y guardar en `this.env`. Esto evita
  acoplar el módulo scoring a un `ConfigService` global que el resto
  del backend no usa. La env se cachea por instancia (singleton del
  módulo), no hay penalty.

Cuando es `true`: comportamiento idéntico al actual. Tests existentes
de cron y scoring siguen pasando si se setea explícitamente.

**Justificación de "early return vs deshabilitar `@Cron` dinámicamente"**:
mantener el cron corriendo (con un guard interno) es más simple que
condicionar el decorator y deja el flag fácil de prender en runtime
desde la env si en algún momento se reactiva.

### 2. Apagar WA automático del cierre de fase

En `phase.service.maybeClosePhase`, eliminar la llamada a:

```ts
await this.notificationsQueue.add(PHASE_WINNER_JOB, {
  phase,
  entryId: winner.entryId,
});
```

El resto del método queda intacto: se sigue creando la `PhaseWinner`
row + audit log + `progression.populate<Next>Matches()`.

Este cambio NO está gated por el feature flag — es una decisión
permanente (no automatizar la notificación al ganador). Si en algún
futuro se quiere reactivar, se vuelve a agregar la línea explícitamente
en otro spec.

El `PhaseWinnerProcessor` queda como código vivo pero sin caller. No
se borra para no acoplar este spec a un cleanup más amplio del módulo
notifications.

### 3. Variables de entorno y configuración

| Var                          | Tipo    | Default | Dónde se define                        |
| ---------------------------- | ------- | ------- | -------------------------------------- |
| `WA_MASS_NOTIFS_ENABLED`     | boolean | `false` | `backend/src/config/env.ts` + `.env.example` |

**Producción** (Dokploy): el repo ya no tiene `docker-compose.yml` —
cada servicio es una Dokploy Application separada con env vars
gestionadas desde la UI. Setear `WA_MASS_NOTIFS_ENABLED=false` en la
Application `prode-backend` → Environment.

Documentar el flag en `docs/deployment.md` (qué controla, cómo
activarlo si se decide reactivar masivos).

## Tests

### Backend — verificaciones nuevas

- ✅ `MatchRemindersCron.sendReminders` con flag `=false` → retorna `0`,
  **no encola** ni una sola Notification. Verificable con un spy sobre
  `NotificationsService.enqueue`.
- ✅ `MatchRemindersCron.sendReminders` con flag `=true` y datos seed
  (matches en ventana 2hs + users sin predicción) → encola la cantidad
  esperada. Este test **es la cobertura del happy path original** —
  asegura que el guard no oculta el comportamiento.
- ✅ `finishMatchAndScore` con flag `=false` → match queda FINISHED,
  predictions evaluadas, leaderboard refresh encolado, **pero**
  `notificationsQueue.add` NUNCA se llama con `MATCH_RESULT_JOB`.
- ✅ `finishMatchAndScore` con flag `=true` → `MATCH_RESULT_JOB` se
  encola exactamente una vez. Happy path original preservado.
- ✅ `recalculateMatch` con flag `=false` y `=true` → mismos dos casos.
- ✅ `maybeClosePhase` cuando todos los matches de la fase terminan →
  `PhaseWinner` row creada + audit log emitido, **pero**
  `PHASE_WINNER_JOB` **no** se encola. Independiente de la flag.

### Specs existentes a actualizar (no borrar)

Estos specs asertaban encolado de jobs que ahora se gatean o se quitan.
**Actualizar**, no borrar, para no perder cobertura:

- `backend/src/modules/scoring/scoring.service.integration.spec.ts` —
  cualquier assert sobre `MATCH_RESULT_JOB` se desdobla en dos casos
  (flag true vs false).
- `backend/src/modules/scoring/phase.service.integration.spec.ts` —
  remover el assert de `PHASE_WINNER_JOB` y agregar uno explícito de
  `not.toHaveBeenCalledWith(PHASE_WINNER_JOB, ...)`.
- `backend/src/test/e2e/prediction-scoring.e2e.spec.ts` — idem
  scoring.
- `backend/src/test/e2e/phase-close.e2e.spec.ts` — idem phase.
- `backend/src/test/e2e/admin-recalculate.e2e.spec.ts` — idem
  recalculate.

### Specs existentes que NO se tocan

`backend/src/modules/notifications/match-result.processor.spec.ts` y
`phase-winner.processor.spec.ts` invocan los processors directamente
con jobs sintéticos y siguen pasando como están. Los processors quedan
vivos pero sin caller (ver §2). No editar.

## Migración a producción

- Setear `WA_MASS_NOTIFS_ENABLED=false` en Dokploy Application
  `prode-backend` → Environment, y agregar la línea al `.env.example`
  del repo.
- Pushear cambios. Verificar en logs del backend que después del próximo
  cron tick (`*/15`) aparezca el log de early-return sin haber encolado
  jobs.
- Verificar al cerrar un partido que el log de scoring sale OK pero
  `MATCH_RESULT_JOB` no aparece en BullMQ.

## Out of scope

- Drawer / compositor admin de premio de fase. El admin contacta a los
  ganadores desde su WA personal.
- Endpoint `POST /admin/notifications/bulk` con cap de destinatarios.
  Se discutió y se descartó (el caso real son 2 personas, no justifica
  UI).
- Throttle adicional defensivo en `wa-backend` (subir `WA_SEND_DELAY_MS`
  o agregar cap diario). El volumen post-apagar masivos cae a esporádico
  — no hay riesgo realista de bloqueo.
- Eliminación del código de `MatchRemindersCron`, `MatchResultProcessor`,
  `PhaseWinnerProcessor`. Quedan vivos pero sin caller / detrás de
  flag. Cleanup futuro si se confirma que no se reactivan.
- Email. Sigue como está hoy (no se usa pero el código existe).
- Cambio de modelo de fases premiables (2 fases + pozo global). Es una
  decisión operativa del admin con el modelo actual de 7 fases —
  ninguna lógica de scoring asume "todas las fases premian".

# WhatsApp: apagar envíos masivos automáticos — Plan

> **For Claude:** Use executing-plans skill to implement this plan task-by-task.

Spec: `docs/superpowers/specs/2026-05-14-wa-limit-mass-sends-design.md`

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Overview

Apagar las dos fuentes de envío masivo automático de WhatsApp
(recordatorios pre-partido + fan-out "sumaste X pts") detrás de un
feature flag `WA_MASS_NOTIFS_ENABLED` (default `false`), y eliminar
permanentemente el WhatsApp automático al ganador de fase. Cero UI
nueva. Cero código nuevo en frontend.

## Prerequisites

- [x] Repo en branch limpio (o branch propio para este cambio).
- [x] Spec aprobado.
- [x] `backend/.env` local con vars actuales (no se rompen).
- [x] `npm test` en `backend/` corre verde antes de empezar.

## Tasks

### Task 1: Agregar env var `WA_MASS_NOTIFS_ENABLED`

**Files:**
- `backend/src/config/env.ts`
- `backend/.env.example`
- `backend/src/config/env.spec.ts`

#### Test First (RED)

Agregar al spec `backend/src/config/env.spec.ts` (en el bloque
`describe('envSchema'`) los siguientes casos. Si el spec usa otra
estructura, adaptá pero mantené los asserts:

```typescript
it('parses WA_MASS_NOTIFS_ENABLED=true as boolean true', () => {
  const result = loadEnvForTest({
    ...validEnvVars,
    WA_MASS_NOTIFS_ENABLED: 'true',
  });
  expect(result.WA_MASS_NOTIFS_ENABLED).toBe(true);
});

it('parses WA_MASS_NOTIFS_ENABLED=false as boolean false', () => {
  const result = loadEnvForTest({
    ...validEnvVars,
    WA_MASS_NOTIFS_ENABLED: 'false',
  });
  expect(result.WA_MASS_NOTIFS_ENABLED).toBe(false);
});

it('defaults WA_MASS_NOTIFS_ENABLED to false when absent', () => {
  const result = loadEnvForTest({ ...validEnvVars });
  expect(result.WA_MASS_NOTIFS_ENABLED).toBe(false);
});

it('rejects WA_MASS_NOTIFS_ENABLED with non-boolean string', () => {
  expect(() =>
    loadEnvForTest({ ...validEnvVars, WA_MASS_NOTIFS_ENABLED: '1' }),
  ).toThrow();
});
```

#### Implementation (GREEN)

En `backend/src/config/env.ts`, dentro del bloque `z.object({ ... })`
después del bloque WhatsApp (línea ~20, después de `ADMIN_WHATSAPP_NUMBER`),
agregar:

```typescript
  /**
   * Master switch for automatic mass WhatsApp sends (pre-match reminders
   * cron + "sumaste X pts" fan-out on match finish/recalc). Default
   * `false` — see spec 2026-05-14-wa-limit-mass-sends-design.md.
   *
   * `z.coerce.boolean()` is unsafe (treats "false" as truthy). The enum
   * + transform pattern below rejects any value that isn't literally
   * "true" or "false".
   */
  WA_MASS_NOTIFS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
```

En `backend/.env.example`, agregar después de la línea 25
(`ADMIN_WHATSAPP_NUMBER`):

```
# Mass WhatsApp sends (pre-match reminders + match-result fan-out).
# Default false to protect the gateway number from rate-limit / shadowban.
# Set to "true" only after coordinating with the gateway operator.
WA_MASS_NOTIFS_ENABLED=false
```

#### Verification

```bash
cd backend && npm test -- --run env.spec
```

Expected: existing env tests + 4 new tests all pass.

---

### Task 2: Guard en `MatchRemindersCron`

**File:** `backend/src/modules/notifications/match-reminders.cron.ts`

#### Implementation

En `sendReminders()`, agregar como primera línea del método (después
del decorator `@Cron(...)` y antes del `const now = new Date();` actual):

```typescript
    if (!this.env.WA_MASS_NOTIFS_ENABLED) {
      this.logger.debug(
        'Match reminders skipped: WA_MASS_NOTIFS_ENABLED=false',
      );
      return 0;
    }
```

Resultado esperado (snippet en contexto):

```typescript
  @Cron('*/15 * * * *')
  async sendReminders(): Promise<number> {
    if (!this.env.WA_MASS_NOTIFS_ENABLED) {
      this.logger.debug(
        'Match reminders skipped: WA_MASS_NOTIFS_ENABLED=false',
      );
      return 0;
    }
    const now = new Date();
    const horizon = new Date(now.getTime() + MatchRemindersCron.LOOKAHEAD_MS);
    ...
```

No hace falta cambiar el constructor — ya carga `this.env = loadEnv()`.

#### Verification

```bash
cd backend && npm run typecheck
```

Expected: zero errors.

---

### Task 3: Inyectar env + guards en `ScoringService`

**File:** `backend/src/modules/scoring/scoring.service.ts`

#### Implementation

**3a)** Agregar import al tope del archivo (junto a los otros imports):

```typescript
import { loadEnv, type Env } from '../../config/env.js';
```

**3b)** Modificar el constructor para cargar la env. Reemplazar:

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringConfig: ScoringConfigService,
    private readonly phaseService: PhaseService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {}
```

por:

```typescript
  private readonly env: Env;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringConfig: ScoringConfigService,
    private readonly phaseService: PhaseService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {
    this.env = loadEnv();
  }
```

**3c)** Gate del fan-out en `finishMatchAndScore`. Reemplazar la línea
~162:

```typescript
    // Fan-out match-result notifications (Phase 11 worker).
    await this.notificationsQueue.add(MATCH_RESULT_JOB, { matchId });
```

por:

```typescript
    // Fan-out match-result notifications (Phase 11 worker). Gated by
    // feature flag — see spec 2026-05-14-wa-limit-mass-sends-design.md.
    if (this.env.WA_MASS_NOTIFS_ENABLED) {
      await this.notificationsQueue.add(MATCH_RESULT_JOB, { matchId });
    }
```

**3d)** Mismo gate en `recalculateMatch`, línea ~285. Reemplazar:

```typescript
    await this.notificationsQueue.add(MATCH_RESULT_JOB, { matchId });
```

por:

```typescript
    if (this.env.WA_MASS_NOTIFS_ENABLED) {
      await this.notificationsQueue.add(MATCH_RESULT_JOB, { matchId });
    }
```

#### Verification

```bash
cd backend && npm run typecheck
```

Expected: zero errors.

---

### Task 4: Eliminar enqueue de `PHASE_WINNER_JOB`

**File:** `backend/src/modules/scoring/phase.service.ts`

#### Implementation

Borrar las líneas ~138-144 (el bloque que encola el job):

```typescript
    // ── Notify the winner (Phase 11 worker handles the actual WhatsApp).
    // Payload carries entryId; the processor resolves the human user via
    // Entry.userId.
    await this.notificationsQueue.add(PHASE_WINNER_JOB, {
      phase,
      entryId: winner.entryId,
    });
```

El resto del método queda igual (incluyendo la creación de
`PhaseWinner` row + audit log + populate de la siguiente fase).

**Importante**: el archivo sigue exportando `PHASE_WINNER_JOB` (línea
13) porque el `PhaseWinnerProcessor` lo importa. Dejar el export
intacto.

#### Verification

```bash
cd backend && npm run typecheck
```

Expected: zero errors.

---

### Task 5: Actualizar `scoring.service.integration.spec.ts`

**File:** `backend/src/modules/scoring/scoring.service.integration.spec.ts`

#### Implementation

Buscar todos los asserts que verifican encolado de `MATCH_RESULT_JOB`
(probablemente algo como `expect(queueAddMock).toHaveBeenCalledWith('match-result', ...)`).
Para cada test que actualmente cubre `finishMatchAndScore` o
`recalculateMatch`:

1. **Antes de cada test que dependía del fan-out**, setear
   `process.env.WA_MASS_NOTIFS_ENABLED = 'true'` y restaurar después
   (usar `beforeEach`/`afterEach` o un wrapper). Si los tests se
   construyen con un módulo NestJS testing, asegurar que `loadEnv()`
   levante el flag.

2. **Agregar dos tests nuevos** (uno para finish, uno para recalculate):

```typescript
describe('with WA_MASS_NOTIFS_ENABLED=false', () => {
  beforeEach(() => {
    process.env.WA_MASS_NOTIFS_ENABLED = 'false';
  });
  afterEach(() => {
    delete process.env.WA_MASS_NOTIFS_ENABLED;
  });

  it('finishMatchAndScore does not enqueue MATCH_RESULT_JOB', async () => {
    // Arrange: seed un match SCHEDULED y predictions
    // Act: scoringService.finishMatchAndScore(...)
    // Assert: queueAddMock no fue llamado con 'match-result'
    expect(queueAddMock).not.toHaveBeenCalledWith(
      'match-result',
      expect.anything(),
    );
  });

  it('recalculateMatch does not enqueue MATCH_RESULT_JOB', async () => {
    // similar al anterior con un match FINISHED
  });
});
```

#### Verification

```bash
cd backend && npm test -- --run scoring.service.integration
```

Expected: existing tests still pass (con env=true seteada) + 2 nuevos
tests con env=false pass.

---

### Task 6: Actualizar `phase.service.integration.spec.ts`

**File:** `backend/src/modules/scoring/phase.service.integration.spec.ts`

#### Implementation

Buscar tests que actualmente assertan
`expect(queueAddMock).toHaveBeenCalledWith('phase-winner', ...)` o
similar. **Invertir los asserts** — ahora ya NO se encola
nunca, independiente de la flag:

```typescript
it('maybeClosePhase does NOT enqueue PHASE_WINNER_JOB', async () => {
  // Arrange: seed phase con todos los matches FINISHED
  // Act: phaseService.maybeClosePhase(phase)
  // Assert: PhaseWinner row creada pero queue add no llamado con 'phase-winner'
  expect(await prisma.phaseWinner.findUnique({ where: { phase } }))
    .not.toBeNull();
  expect(queueAddMock).not.toHaveBeenCalledWith(
    'phase-winner',
    expect.anything(),
  );
});
```

Si había asserts positivos sobre el encolado, **borrarlos** (el WA
del ganador es decisión permanente del spec, no gated por flag).

#### Verification

```bash
cd backend && npm test -- --run phase.service.integration
```

Expected: tests pass con la nueva semantica.

---

### Task 7: Actualizar `prediction-scoring.e2e.spec.ts`

**File:** `backend/src/test/e2e/prediction-scoring.e2e.spec.ts`

#### Implementation

Mismo patrón que Task 5: si el test depende del fan-out
`MATCH_RESULT_JOB`, setear `WA_MASS_NOTIFS_ENABLED=true` en el setup
del bloque. Si solo verifica que el scoring corre OK pero no inspecciona
el queue, el test sigue verde sin cambios.

Buscar grep dentro del archivo:

```bash
grep -n "MATCH_RESULT_JOB\|match-result\|fan-out\|queueAdd" backend/src/test/e2e/prediction-scoring.e2e.spec.ts
```

Si **no hay hits**, marcar la task como completed sin cambios. Si los
hay, decidir: ¿el test verifica el encolado? Si sí, setear la env
arriba del describe.

#### Verification

```bash
cd backend && npm test -- --run prediction-scoring.e2e
```

Expected: all pass.

---

### Task 8: Actualizar `phase-close.e2e.spec.ts`

**File:** `backend/src/test/e2e/phase-close.e2e.spec.ts`

#### Implementation

Mismo patrón. Grep:

```bash
grep -n "PHASE_WINNER_JOB\|phase-winner\|queueAdd" backend/src/test/e2e/phase-close.e2e.spec.ts
```

Si hay asserts positivos sobre `PHASE_WINNER_JOB` siendo encolado,
invertirlos a `not.toHaveBeenCalled`. Si verifica solo que la
`PhaseWinner` row se crea, sigue verde sin cambios.

#### Verification

```bash
cd backend && npm test -- --run phase-close.e2e
```

Expected: all pass.

---

### Task 9: Actualizar `admin-recalculate.e2e.spec.ts`

**File:** `backend/src/test/e2e/admin-recalculate.e2e.spec.ts`

#### Implementation

Mismo patrón que Task 7. Grep para `MATCH_RESULT_JOB` o `match-result`.
Si hay asserts del encolado, setear `WA_MASS_NOTIFS_ENABLED=true` en
el setup del test que lo necesite. Caso contrario, sin cambios.

#### Verification

```bash
cd backend && npm test -- --run admin-recalculate.e2e
```

Expected: all pass.

---

### Task 10: Documentar en `docs/deployment.md`

**File:** `docs/deployment.md`

#### Implementation

Agregar una sección al final del archivo (o donde corresponda según
la estructura actual):

```markdown
## Feature flag: `WA_MASS_NOTIFS_ENABLED`

Controla los envíos masivos automáticos de WhatsApp:

- **`false`** (default): se apagan el cron de recordatorios pre-partido
  (`MatchRemindersCron`) y el fan-out de "sumaste X pts en el partido"
  al cargar/recalcular un resultado. Esta es la configuración de
  producción porque el número del gateway es nuevo y sensible al
  rate-limit de WhatsApp.
- **`true`**: comportamiento histórico — el cron encola recordatorios y
  el scoring encola un job por cada entry que sumó puntos.

**Cómo cambiarlo en prod (Dokploy)**:

1. Dokploy → Application `prode-backend` → Environment.
2. Setear `WA_MASS_NOTIFS_ENABLED=true` o `false`.
3. Redeploy.

**Nota**: el WhatsApp automático al ganador de fase se eliminó de forma
permanente (no gated por este flag). Si se quiere reactivar, hay que
volver a agregar la línea en `phase.service.maybeClosePhase` con un
spec nuevo.
```

#### Verification

```bash
grep -c "WA_MASS_NOTIFS_ENABLED" docs/deployment.md
```

Expected: `>= 2`.

---

### Task 11: Commit + push

#### Implementation

```bash
cd /Users/nicolasvelazquez/Desktop/dev/prode
git status
# Verificar que solo los archivos modificados por las tasks 1-10 aparezcan.

git add backend/src/config/env.ts backend/src/config/env.spec.ts \
        backend/.env.example \
        backend/src/modules/notifications/match-reminders.cron.ts \
        backend/src/modules/scoring/scoring.service.ts \
        backend/src/modules/scoring/phase.service.ts \
        backend/src/modules/scoring/scoring.service.integration.spec.ts \
        backend/src/modules/scoring/phase.service.integration.spec.ts \
        backend/src/test/e2e/prediction-scoring.e2e.spec.ts \
        backend/src/test/e2e/phase-close.e2e.spec.ts \
        backend/src/test/e2e/admin-recalculate.e2e.spec.ts \
        docs/deployment.md \
        docs/plans/2026-05-14-wa-limit-mass-sends-plan.md

git commit -m "$(cat <<'EOF'
feat(wa): apagar envíos masivos automáticos de WhatsApp

Detrás de `WA_MASS_NOTIFS_ENABLED` (default false):
- cron de recordatorios pre-partido (MatchRemindersCron)
- fan-out "sumaste X pts" al cerrar/recalcular match

Permanente (no gated por flag):
- WhatsApp automático al ganador de fase (maybeClosePhase ya no encola
  PHASE_WINNER_JOB). El admin contacta a los pocos ganadores reales
  desde su WhatsApp personal.

Motivación: el número del gateway Baileys es nuevo y sensible al
rate-limit. Spec en docs/superpowers/specs/2026-05-14-wa-limit-mass-sends-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push origin main
```

#### Verification

```bash
git log -1 --stat
```

Expected: commit con ~10-12 archivos modificados.

---

## Integration Tests

Después de completar todas las tasks:

```bash
cd backend && npm test
```

Expected: todos los tests verdes, incluyendo los nuevos casos de
flag=false.

```bash
cd backend && npm run typecheck
```

Expected: zero errors.

## Manual Verification

1. Levantar el backend localmente con `WA_MASS_NOTIFS_ENABLED=false`.
2. Cargar el resultado de un partido finalizado desde el panel admin
   (`/admin/partidos/[id]`).
3. Verificar en los logs:
   - Aparece "Match X finished: scored N predictions, multiplier=…"
   - **NO** aparece "match-result: enqueued N recap(s)…"
4. Cerrar una fase desde `/admin/fases` (cuando todos los matches
   finalizaron). Verificar:
   - Aparece "Closed phase X: winnerEntry=…"
   - **NO** se encola `PHASE_WINNER_JOB` (revisar BullMQ dashboard o
     logs del processor).
5. Esperar el próximo tick del cron de recordatorios (o trigger
   manual). Verificar log:
   - Aparece "Match reminders skipped: WA_MASS_NOTIFS_ENABLED=false"
   - No se encola ninguna Notification.

## Rollback Plan

Si algo sale mal y necesitamos volver al comportamiento histórico **sin
revertir el código**:

1. Setear `WA_MASS_NOTIFS_ENABLED=true` en Dokploy → redeploy.
2. El fan-out de match-result y el cron de recordatorios vuelven a
   correr exactamente como antes.

Lo que **no se revierte por flag**: el WhatsApp automático al ganador
de fase (decisión permanente). Para recuperarlo, hay que revertir el
commit:

```bash
git revert <commit-sha>
```

O re-agregar manualmente la línea borrada en
`phase.service.maybeClosePhase`.

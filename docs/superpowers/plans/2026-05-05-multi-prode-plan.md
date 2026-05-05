# Multi-prode v1.1 — Implementation Plan

> **For Claude:** Use executing-plans skill to implement this plan task-by-task. Reference `docs/superpowers/specs/2026-05-05-multi-prode-design.md` for full design detail; this plan instructs *how* to build it.

## Remember
- Exact file paths always
- Complete code for non-obvious logic; reference spec for code that's already there
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits (1 commit per task minimum)
- All paths relative to `/Users/nicolasvelazquez/Desktop/dev/prode/` unless stated otherwise
- Backend code in `backend/`; frontend in `frontend/`
- Use `npm` and `npx`, not `pnpm`

## Overview

Multi-prode permite que un usuario pague múltiples veces y juegue varios prodes con predicciones independientes. Cap configurable (default 5) desde admin.

**Spec de referencia (autoridad):** `docs/superpowers/specs/2026-05-05-multi-prode-design.md`

**Alcance del cambio:**
- Schema: nuevo modelo `Entry`, refactor de `Prediction`/`SpecialPrediction`/`PhaseWinner`/`LeagueMembership` para usar `entryId`
- Backend: 2 endpoints nuevos (`POST /entries/init-payment`, `GET /entries/me`, etc.), refactor de servicios afectados
- Frontend: ActiveEntryProvider + EntrySwitcher + NewEntryModal, refactor de queryKeys
- Migración: M1 additive → backfill script con dry-run → M2 destructive + recreate MV
- Deploy atómico (sin feature flags)

**Estimación: ~3.5 días** (2 backend + 1 frontend + 0.5 test refactor).

## Prerequisites

- [ ] Spec aprobado por el cliente
- [ ] Sistema base estable (124+ tests frontend, 344+ tests backend passing)
- [ ] Postgres + Redis corriendo
- [ ] Backup snapshot manual de la BD antes de empezar (en dev también, por las dudas)
- [ ] Estar en branch dedicada (`feat/multi-prode` o seguir en `remove-landing` si está disponible)

## Estructura del plan

11 fases. Phase 0 (pre-flight) y Phase 10 (deploy) son no-código. El core va en Phase 1-9.

| Fase | Nombre | Tareas | Touch |
|------|--------|--------|-------|
| 0 | Pre-flight + dry-run script | 2 | scripts/, docs |
| 1 | Schema M1 (additive) | 3 | prisma/, BD |
| 2 | Backfill script | 4 | scripts/, BD |
| 3 | Schema M2 + MV recreate | 3 | prisma/, BD |
| 4 | Backend services refactor | 8 | backend/src/modules/* |
| 5 | Backend new endpoints | 6 | backend/src/modules/entries/, payments, auth |
| 6 | Backend tests refactor | 4 | backend/src/**/*.spec.ts |
| 7 | Frontend types + queryKeys | 2 | frontend/lib/api/ |
| 8 | Frontend ActiveEntryProvider + EntrySwitcher | 5 | frontend/providers/, components/ |
| 9 | Frontend pages migration | 6 | frontend/app/(app)/* |
| 10 | Frontend tests + E2E | 3 | frontend/tests/ |
| 11 | Deploy atómico | 2 | dokploy, docs |

**Total estimado: ~48 tareas atómicas.**

---

# FASE 0 — Pre-flight + dry-run script

**Goal:** preparar el environment, escribir el script que valida la salud de la migración antes de correrla.

## Task 0.1 — Snapshot manual de la BD

**Files:** ninguno (operación de infra)

**Acción:**
```bash
docker exec prode-postgres pg_dump -U prode prode -F c -f /tmp/prode_pre_multi_prode_$(date +%Y%m%d_%H%M%S).dump
docker cp prode-postgres:/tmp/prode_pre_multi_prode_*.dump /Users/nicolasvelazquez/Desktop/dev/prode/backups/
```

**Acceptance:** archivo `.dump` ~10-50MB en `/Users/nicolasvelazquez/Desktop/dev/prode/backups/`.

**Verification:** `ls backups/` muestra el archivo. Con `pg_restore --list backups/<file>.dump | head` se ven las tablas.

**Commit:** ninguno (los `.dump` no van al repo, agregar al `.gitignore` si no está).

---

## Task 0.2 — Dry-run script

**File:** `backend/scripts/multi-prode-migration-dryrun.ts` (nuevo)

**Goal:** script idempotente que reporta el estado pre-migración SIN modificar nada.

**Acceptance:**
- Reporta:
  - Total Users, Users con Payment APPROVED, Users sin Payment APPROVED
  - Users con múltiples Payments APPROVED (alerta + lista de IDs)
  - Predictions huérfanas: COUNT WHERE userId NOT IN (SELECT userId FROM payments WHERE status='APPROVED')
  - Idem SpecialPredictions, PhaseWinners, LeagueMemberships
  - Total ABORT_THRESHOLD = 5 (configurable). Si alguno > threshold, exit code 1 (CI rejection)
- Salida format: human-readable (table) + JSON detail (--json flag)

**Code skeleton:**
```typescript
// backend/scripts/multi-prode-migration-dryrun.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const ABORT_THRESHOLD = 5;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const totals = await prisma.$queryRaw<{ users: bigint; usersWithPayment: bigint }[]>`
    SELECT
      (SELECT COUNT(*) FROM users)::bigint AS users,
      (SELECT COUNT(DISTINCT u.id) FROM users u WHERE EXISTS (SELECT 1 FROM payments p WHERE p."userId" = u.id AND p.status = 'APPROVED'))::bigint AS "usersWithPayment"
  `;

  const orphans = await prisma.$queryRaw<{ kind: string; count: bigint }[]>`
    SELECT 'predictions'::text AS kind,
      (SELECT COUNT(*) FROM predictions p WHERE NOT EXISTS (
         SELECT 1 FROM payments pay WHERE pay."userId" = p."userId" AND pay.status = 'APPROVED'
      ))::bigint AS count
    UNION ALL
    SELECT 'special_predictions',
      (SELECT COUNT(*) FROM special_predictions sp WHERE NOT EXISTS (
         SELECT 1 FROM payments pay WHERE pay."userId" = sp."userId" AND pay.status = 'APPROVED'
      ))::bigint
    -- ... idem para phase_winners y league_memberships
  `;

  const multiPay = await prisma.$queryRaw<{ userId: string; payments: bigint }[]>`
    SELECT "userId", COUNT(*)::bigint AS payments
    FROM payments WHERE status = 'APPROVED' AND "userId" IS NOT NULL
    GROUP BY "userId" HAVING COUNT(*) > 1
  `;

  console.log('=== Multi-prode Migration Dry-Run ===');
  console.log(`Total users: ${totals[0].users}`);
  console.log(`Users con Payment APPROVED (futuro Entry #1): ${totals[0].usersWithPayment}`);
  console.log(`\nUsers con múltiples Payments APPROVED (solo el más antiguo se usa):`);
  multiPay.forEach((u) => console.log(`  - userId=${u.userId} payments=${u.payments}`));
  console.log(`\nFilas huérfanas (sin Payment APPROVED del user, serán DELETED):`);
  let abort = false;
  orphans.forEach((o) => {
    const n = Number(o.count);
    const flag = n > ABORT_THRESHOLD ? ' ⛔' : '';
    if (n > ABORT_THRESHOLD) abort = true;
    console.log(`  - ${o.kind}: ${n}${flag}`);
  });

  if (abort) {
    console.error(`\n❌ ABORT: huérfanas > threshold ${ABORT_THRESHOLD}. Investigar antes de continuar.`);
    process.exit(1);
  }
  console.log('\n✅ OK para proceder con M1 + backfill.');
}

main().finally(() => prisma.$disconnect());
```

**Verification:**
```bash
cd backend && npx tsx scripts/multi-prode-migration-dryrun.ts
# Expected: report, exit 0
```

**Commit:** `feat(backend/scripts): add multi-prode migration dry-run with orphan threshold`

---

# FASE 1 — Schema M1 (additive)

**Goal:** agregar tabla `entries`, columnas `entryId NULLABLE` en las 4 tablas, sin romper sistema actual.

## Task 1.1 — Update schema.prisma con Entry + EntryStatus

**File:** `backend/prisma/schema.prisma`

**Acceptance:**
- Nuevo enum `EntryStatus { ACTIVE, ANNULLED }`
- Nuevo enum value `OVER_CAP` en `PaymentStatus`
- Nuevo modelo `Entry` exactamente como spec §2.1 (incluye `status @default(ACTIVE)`)
- En `Prediction`: agregar `entryId String?` + relation, mantener `userId` por ahora
- Idem `SpecialPrediction`, `PhaseWinner`, `LeagueMembership`
- En `User`: agregar `entries Entry[]` (relation field). Mantener las relaciones viejas todavía.
- En `Payment`: agregar `entry Entry?` (1-1 inverso) + `entryAlias String?`

**Verification:** `npx prisma validate && npx prisma format --check`.

**Commit:** `feat(backend/prisma): add Entry model + nullable entryId columns (M1 additive)`

---

## Task 1.2 — Generar migración M1

**Files:** `backend/prisma/migrations/<timestamp>_multi_prode_m1_additive/migration.sql`

```bash
cd backend && npx prisma migrate dev --name multi_prode_m1_additive --create-only
```

Editar el SQL generado si es necesario para asegurar que las columnas quedan NULLABLE.

**Acceptance:**
- Migration crea tabla `entries`
- Migration agrega columnas `entryId` nullable a las 4 tablas
- Migration NO borra ninguna columna
- Aplicar: `npx prisma migrate dev`

**Verification:**
```bash
PGPASSWORD=prode_dev_pwd psql -h localhost -p 5433 -U prode -d prode -c "\d entries"
# Expected: tabla con columnas userId, paymentId, position, alias, status, etc.

PGPASSWORD=prode_dev_pwd psql -h localhost -p 5433 -U prode -d prode -c "\d predictions" | grep entryId
# Expected: entryId | text | nullable
```

**Commit:** `feat(backend): apply migration multi_prode_m1_additive`

---

## Task 1.3 — Regenerar Prisma client

```bash
cd backend && npx prisma generate
```

**Acceptance:** el cliente Prisma ahora exporta `prisma.entry.*` y los modelos refactorizados tienen `entryId?` opcional.

**Verification:** `npx tsc --noEmit` no rompe nada (los servicios actuales todavía usan `userId`, sigue funcional).

**Commit:** ninguno (regenerate sólo, los archivos van a `generated/` que está en `.gitignore`).

---

# FASE 2 — Backfill script

**Goal:** popular las nuevas columnas/tabla a partir de los datos actuales.

## Task 2.1 — Backfill SQL completo

**File:** `backend/scripts/multi-prode-backfill.ts` (nuevo)

**Acceptance:**
- Script idempotente (re-runnable sin efectos secundarios)
- 5 secciones SQL en TX:
  1. INSERT entries por cada user con Payment APPROVED (most recent NOT, take oldest)
  2. UPDATE predictions.entryId
  3. UPDATE special_predictions.entryId
  4. UPDATE phase_winners.entryId (si aplica — todos los existentes deberían tener Payment del user)
  5. UPDATE league_memberships.entryId
- ASSERT post-backfill: COUNT WHERE entryId IS NULL == 0 en las 4 tablas (excluyendo huérfanas que se borrarán next)

**Code skeleton:**
```typescript
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.$transaction(async (tx) => {
    console.log('1. Creating Entry #1 per user with APPROVED Payment...');
    await tx.$executeRaw`
      INSERT INTO entries (id, "userId", "paymentId", "position", "status", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, p."userId", p.id, 1, 'ACTIVE', NOW(), NOW()
      FROM payments p
      WHERE p.status = 'APPROVED' AND p."userId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM entries e WHERE e."userId" = p."userId")
        AND p.id = (
          SELECT id FROM payments p2
          WHERE p2."userId" = p."userId" AND p2.status = 'APPROVED'
          ORDER BY p2."createdAt" ASC LIMIT 1
        )
    `;

    console.log('2. Backfilling predictions.entryId...');
    await tx.$executeRaw`
      UPDATE predictions p
      SET "entryId" = (SELECT e.id FROM entries e WHERE e."userId" = p."userId" LIMIT 1)
      WHERE p."entryId" IS NULL
    `;

    // ... 3, 4, 5 análogos para special_predictions, phase_winners, league_memberships
  });
  console.log('✅ Backfill completed');
}
main().finally(() => prisma.$disconnect());
```

**Acceptance:**
- Re-run del script no duplica entries (idempotente vía `NOT EXISTS`)
- Después de correr, todos los `predictions/special_predictions/phase_winners/league_memberships` con userId que tiene Payment APPROVED tienen `entryId NOT NULL`

**Verification:**
```bash
cd backend && npx tsx scripts/multi-prode-backfill.ts
# Re-run twice, verify no duplicates
PGPASSWORD=prode_dev_pwd psql -h localhost -p 5433 -U prode -d prode -c \
  "SELECT COUNT(*) FROM entries"
# Expected: count(usersWithPayment) del dry-run
```

**Commit:** `feat(backend/scripts): multi-prode backfill (idempotent)`

---

## Task 2.2 — Backup tables de huérfanas

**File:** `backend/scripts/multi-prode-backup-orphans.sql` (nuevo)

**Acceptance:**
- SQL que crea 4 tablas `_backup_2026_05_XX` con las filas huérfanas antes del DELETE
- Tablas tienen un comentario con la fecha de backup
- Si las tablas ya existen, las recrea (DROP + CREATE) para evitar mezcla con runs previos

**Code:**
```sql
-- backend/scripts/multi-prode-backup-orphans.sql

DROP TABLE IF EXISTS predictions_orphaned_backup_2026_05_XX;
CREATE TABLE predictions_orphaned_backup_2026_05_XX AS
SELECT * FROM predictions WHERE "entryId" IS NULL;

DROP TABLE IF EXISTS special_predictions_orphaned_backup_2026_05_XX;
CREATE TABLE special_predictions_orphaned_backup_2026_05_XX AS
SELECT * FROM special_predictions WHERE "entryId" IS NULL;

-- ... idem para phase_winners y league_memberships

COMMENT ON TABLE predictions_orphaned_backup_2026_05_XX
  IS 'Backed up orphan predictions before multi-prode M2 migration. Retain 30 days.';
```

**Verification:**
```bash
PGPASSWORD=prode_dev_pwd psql -h localhost -p 5433 -U prode -d prode \
  -f backend/scripts/multi-prode-backup-orphans.sql
PGPASSWORD=prode_dev_pwd psql -h localhost -p 5433 -U prode -d prode -c "\dt *_orphaned_*"
```

**Commit:** `feat(backend/scripts): backup orphan rows before M2 migration`

---

## Task 2.3 — Delete orphans

**File:** `backend/scripts/multi-prode-delete-orphans.sql` (nuevo)

**Acceptance:**
- Después del backup, DELETE FROM las 4 tablas WHERE entryId IS NULL
- ASSERT post-delete: COUNT WHERE entryId IS NULL == 0

**Verification:**
```bash
PGPASSWORD=prode_dev_pwd psql -h localhost -p 5433 -U prode -d prode \
  -f backend/scripts/multi-prode-delete-orphans.sql
# Expected: DELETE counts + assert OK
```

**Commit:** `feat(backend/scripts): delete orphan predictions/etc with assert`

---

## Task 2.4 — End-to-end Phase 2 verification

```bash
cd backend
npx tsx scripts/multi-prode-migration-dryrun.ts  # NO debe quejarse
npx tsx scripts/multi-prode-backfill.ts
psql ... -f scripts/multi-prode-backup-orphans.sql
psql ... -f scripts/multi-prode-delete-orphans.sql

# Final assert
PGPASSWORD=prode_dev_pwd psql -h localhost -p 5433 -U prode -d prode -c \
  "SELECT 
    (SELECT COUNT(*) FROM predictions WHERE \"entryId\" IS NULL) AS predictions_null,
    (SELECT COUNT(*) FROM special_predictions WHERE \"entryId\" IS NULL) AS sp_null,
    (SELECT COUNT(*) FROM phase_winners WHERE \"entryId\" IS NULL) AS pw_null,
    (SELECT COUNT(*) FROM league_memberships WHERE \"entryId\" IS NULL) AS lm_null"
# Expected: todos = 0
```

**Commit:** ninguno, sólo verificación.

---

# FASE 3 — Schema M2 (destructive) + MV recreate

**Goal:** hacer las columnas `entryId` NOT NULL, dropear las `userId`, recrear MV.

## Task 3.1 — Update schema.prisma para M2

**File:** `backend/prisma/schema.prisma`

**Cambios:**
- En `Prediction`: cambiar `entryId String?` a `entryId String`. Borrar `userId` y la relation a User. Cambiar `@@unique([userId, matchId])` por `@@unique([entryId, matchId])`. Borrar `@@index([userId, evaluatedAt])`, agregar `@@index([entryId, evaluatedAt])`.
- Idem `SpecialPrediction`: `entryId String @unique`, borrar `userId`.
- Idem `PhaseWinner`: borrar `userId`, cambiar relation.
- Idem `LeagueMembership`: borrar `userId`, cambiar `@@unique([leagueId, userId])` por `@@unique([leagueId, entryId])`.
- En `User`: borrar `predictions`, `specialPrediction`, `phaseWins`, `leagueMemberships` relations (no aplican más).

**Verification:** `npx prisma validate && npx prisma format --check`

**Commit:** `feat(backend/prisma): schema M2 — entries replace userId in 4 tables`

---

## Task 3.2 — Generar migración M2 con MV recreate

**Files:** `backend/prisma/migrations/<timestamp>_multi_prode_m2_destructive/migration.sql`

```bash
cd backend && npx prisma migrate dev --name multi_prode_m2_destructive --create-only
```

Editar el SQL generado para agregar al inicio:
```sql
-- DROP de la MV antes de las column drops (si no, fall por dependency)
DROP MATERIALIZED VIEW IF EXISTS leaderboard_global;
```

Y al final:
```sql
-- Recreate MV con grouping por entry_id (spec §2.5)
CREATE MATERIALIZED VIEW leaderboard_global AS
SELECT
  e.id AS entry_id,
  e."userId" AS user_id,
  e.position AS entry_position,
  e.alias AS entry_alias,
  u.first_name,
  u.last_name,
  COALESCE(SUM(p."pointsEarned"), 0) +
    COALESCE(sp."totalPoints", 0) AS total_points,
  COUNT(p.id) FILTER (WHERE p."outcomeType" = 'EXACT') AS exact_count,
  COUNT(p.id) FILTER (WHERE p."outcomeType" IN ('EXACT','WINNER_AND_DIFF','WINNER_ONLY','DRAW_DIFFERENT')) AS hits_count,
  sp."championTeamId" IS NOT NULL AS has_champion_pick
FROM entries e
INNER JOIN users u ON u.id = e."userId"
LEFT JOIN predictions p ON p."entryId" = e.id
LEFT JOIN special_predictions sp ON sp."entryId" = e.id
WHERE u.status = 'ACTIVE' AND e.status = 'ACTIVE'
GROUP BY e.id, e."userId", e.position, e.alias, u.first_name, u.last_name, sp."totalPoints", sp."championTeamId";

CREATE UNIQUE INDEX leaderboard_global_entry_id_idx ON leaderboard_global (entry_id);
CREATE INDEX leaderboard_global_total_points_idx
  ON leaderboard_global (total_points DESC, exact_count DESC, hits_count DESC);
CREATE INDEX leaderboard_global_user_id_idx ON leaderboard_global (user_id);

REFRESH MATERIALIZED VIEW leaderboard_global;
```

Aplicar: `npx prisma migrate dev`.

**Acceptance:**
- Migration corre sin errores
- Predictions y otras 3 tablas ya no tienen `userId`
- MV `leaderboard_global` existe con nuevos campos

**Verification:**
```bash
PGPASSWORD=prode_dev_pwd psql -h localhost -p 5433 -U prode -d prode -c "\d predictions" | grep userId
# Expected: nada (columna eliminada)

PGPASSWORD=prode_dev_pwd psql -h localhost -p 5433 -U prode -d prode -c "\d leaderboard_global"
# Expected: columnas entry_id, user_id, entry_position, entry_alias, etc.
```

**Commit:** `feat(backend): apply M2 destructive + recreate leaderboard_global MV`

---

## Task 3.3 — Regenerate client + verify build

```bash
cd backend && npx prisma generate && npx tsc --noEmit 2>&1 | head -20
```

**Acceptance:** TypeScript va a tirar MUCHOS errores ahora — todos los servicios que usen `prediction.userId`, `User.predictions`, etc., están rotos. Esto es esperado. Los arreglamos en Fase 4.

**Commit:** ninguno aún.

---

# FASE 4 — Backend services refactor

**Goal:** todos los servicios cambian de `userId` a `entryId`. Compila al final.

## Task 4.1 — PredictionsService

**File:** `backend/src/modules/predictions/predictions.service.ts`

Cambios:
- `upsertMatchPrediction(userId, matchId, dto)` → `upsertMatchPrediction(entryId, matchId, dto)`
- `getMyPredictions(userId, ...)` → `getEntryPredictions(entryId, ...)`
- Validar que `entryId` existe + pertenece a `currentUser` (vía repository helper)
- Constraint check: `now() < match.predictionsLockAt` (sin cambios)
- Audit log incluye `entryId`

Análogo para `special-predictions.service.ts`.

**Tests:** todos los specs de predictions rompen — actualizar en Fase 6.

**Verification:** typecheck del file pasa. La page completa todavía rompe.

**Commit:** `refactor(backend/predictions): switch from userId to entryId`

---

## Task 4.2 — ScoringService

**File:** `backend/src/modules/scoring/scoring.service.ts`

`finishMatchAndScore` itera sobre `predictions WHERE matchId = ?` — por entry no por user. La lógica de cálculo es idéntica (función pura `classifyOutcome` no cambia).

`recalculateMatch` idem.

`computePhaseWinner(phase)` ahora agrupa por `entryId`:
```typescript
const winnerRow = await prisma.$queryRaw<{ entryId: string, total: number }[]>`
  SELECT p."entryId", SUM(p."pointsEarned") AS total
  FROM predictions p
  INNER JOIN matches m ON m.id = p."matchId"
  WHERE m.phase = ${phase}
  GROUP BY p."entryId"
  ORDER BY total DESC, ... -- desempates
  LIMIT 1
`;
// PhaseWinner.entryId ahora apunta al entry ganador
```

**Commit:** `refactor(backend/scoring): rank by entryId, PhaseWinner.entryId`

---

## Task 4.3 — PhaseService.maybeClosePhase

**File:** `backend/src/modules/scoring/phase.service.ts`

`PhaseWinner` ahora se crea con `entryId` (no `userId`). El job `phase-winner` payload cambia a `{ phase, entryId }` (ver task 4.4).

**Commit:** `refactor(backend/scoring): PhaseWinner uses entryId`

---

## Task 4.4 — Phase-winner notification processor

**File:** `backend/src/modules/notifications/phase-winner.processor.ts`

Payload cambia: `{ phase, entryId }`. El processor resuelve el user con `Entry.userId` y manda el WhatsApp:
```typescript
async handle(job: Job<{ phase: Phase; entryId: string }>) {
  const entry = await this.prisma.entry.findUnique({
    where: { id: job.data.entryId },
    include: { user: true },
  });
  if (!entry?.user.whatsappOptIn) return;
  // ... mensaje con alias del entry: "Ganaste con tu prode '{alias}'"
}
```

Actualizar el caller en `phase.service.ts` para pasar `{ phase, entryId }`.

**Commit:** `refactor(backend/notifications): phase-winner job uses entryId`

---

## Task 4.5 — LeaderboardRepository

**File:** `backend/src/modules/leaderboard/leaderboard.repository.ts`

Ya consume la MV `leaderboard_global` que ahora rankea por `entryId`. Update queries:
- `getGlobal(page, pageSize)`: SELECT all rows from MV ordered by total_points DESC + tiebreakers
- `getGlobalAroundEntry(entryId, n)`: nuevo método (reemplaza `getGlobalAroundUser`). CTE con ROW_NUMBER + filtro alrededor del entry específico
- `getByPhase(phase, page, pageSize)`: ahora agrupa por `entryId` con `predictions JOIN matches`
- `getByLeague(leagueId, page, pageSize)`: JOIN entries en lugar de users

Las shapes de los rows cambian: agregan `entry_id`, `entry_position`, `entry_alias`. Los consumers (controller, service) los pasan al frontend.

**Commit:** `refactor(backend/leaderboard): MV by entry, add aroundEntry`

---

## Task 4.6 — LeaderboardController + Service

**File:** `backend/src/modules/leaderboard/leaderboard.controller.ts`

Endpoint changes:
- `GET /leaderboard/me/around` → `GET /leaderboard/entry/:entryId/around` (con auth, valida que el entryId pertenece al user)
- `GET /leaderboard/global` y `/phase/:phase` mantienen el path, sólo cambia el shape del response

**Commit:** `refactor(backend/leaderboard): /entry/:entryId/around endpoint`

---

## Task 4.7 — LeaguesService

**File:** `backend/src/modules/leagues/leagues.service.ts`

Cambios:
- `createLeague(userId, dto + entryId?)` — owner es User, primera membership es Entry
- `joinLeague(entryId, inviteCode)` — el join es por entry, no user
- Validaciones:
  - Entry pertenece al currentUser
  - Si entry ya es miembro de la liga: 409 ALREADY_LEAGUE_MEMBER
  - Cap de members (count distinct entries)

**Commit:** `refactor(backend/leagues): membership por entryId`

---

## Task 4.8 — Auth + Users + Audit

**Files:** `auth.controller.ts`, `users.controller.ts`

- `POST /auth/complete-registration`: la TX que crea el User ahora también crea Entry #1 vinculada al Payment
- `GET /auth/me`: incluye lista resumida de entries del user
- `GET /users/:id/public-profile`: agrega lista de entries del user con sus stats (predicciones finished aggregadas por entry)
- `POST /admin/users` (manual user create): además del User + Payment, crea Entry #1

Audit logs nuevos: `entry.created`, `entry.alias_updated`, `entry.over_cap_orphaned`.

**Commit:** `refactor(backend/auth+users): create Entry #1 in registration flows + /auth/me includes entries`

---

# FASE 5 — Backend new endpoints

**Goal:** los endpoints específicos de Entry.

## Task 5.1 — POST /entries/init-payment

**Files:**
- `backend/src/modules/entries/entries.controller.ts` (nuevo)
- `backend/src/modules/entries/entries.service.ts` (nuevo)
- `backend/src/modules/entries/dto/init-payment.dto.ts`
- `backend/src/modules/entries/entries.module.ts`

```typescript
@Controller('entries')
export class EntriesController {
  @Post('init-payment')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async initPayment(@CurrentUser() user: User, @Body() dto: InitPaymentDto) {
    // En TX:
    //   SELECT COUNT(*) FROM entries WHERE userId = user.id FOR UPDATE
    //   if (count >= max_entries_per_user) throw new EntryCapReachedException()
    //   tokenPlain = randomBytes
    //   tokenHash = sha256
    //   payment = create Payment{userId, amount, status PENDING, completionTokenHash, entryAlias}
    //   preference = checkoutProvider.createPreference({
    //     metadata: { completion_token: tokenPlain, entry_alias: dto.alias },
    //     back_urls: { success: ${FRONTEND}/inscripcion/success?paymentId=${payment.id}&logged=1, ... }
    //   })
    //   payment.update({ mpPreferenceId: preference.id })
    // Devuelve { paymentId, initPoint }
  }
}
```

`EntryCapReachedException` (nueva en `domain.exceptions.ts`): 409, `code: 'ENTRY_CAP_REACHED'`, body con `{ current, cap }`.

**Tests:**
- 1 entry, count<cap → OK
- count>=cap → 409
- Race: 2 requests paralelos del mismo user con count=4 → uno OK, otro 409 (TX + FOR UPDATE serializa)

**Commit:** `feat(backend/entries): POST /entries/init-payment with cap check (FOR UPDATE)`

---

## Task 5.2 — Webhook MP refactor: crear Entry para flow logueado

**File:** `backend/src/modules/payments/payments.service.ts`

En el handler (cuando newStatus === APPROVED y `local.userId IS NOT NULL`):

```typescript
if (local.userId) {
  // Re-check cap (race con admin que bajó)
  const count = await tx.entry.count({ where: { userId: local.userId } });
  const cap = await this.scoringConfig.getMaxEntriesPerUser();
  if (count >= cap) {
    await tx.payment.update({
      where: { id: local.id },
      data: { status: 'OVER_CAP' },
    });
    await this.adminAlerts.notify({
      type: 'PAYMENT_OVER_CAP',
      message: `Payment ${local.id} aprobado pero user ${local.userId} ya está al cap (${count}/${cap}). Refund manual.`,
    });
    return; // no crear Entry
  }
  // Crear Entry
  const maxPosition = await tx.entry.aggregate({
    where: { userId: local.userId },
    _max: { position: true },
  });
  await tx.entry.create({
    data: {
      userId: local.userId,
      paymentId: local.id,
      position: (maxPosition._max.position ?? 0) + 1,
      alias: local.entryAlias,
      status: 'ACTIVE',
    },
  });
  // Audit
  await tx.auditLog.create({ data: { action: 'entry.created', entity: 'entry', ... } });
}
```

NO encolar email de recovery (user ya está logueado).

**Commit:** `feat(backend/payments): webhook creates Entry for logged-in flow with cap re-check`

---

## Task 5.3 — GET /entries/me + GET /entries/:id

**File:** `backend/src/modules/entries/entries.controller.ts`

```typescript
@Get('me')
@UseGuards(JwtAuthGuard)
async myEntries(@CurrentUser() user: User) {
  // Lista de entries con stats
  return this.entriesService.listForUser(user.id);
}

@Get(':id')
@UseGuards(JwtAuthGuard)
async detail(@CurrentUser() user: User, @Param('id') id: string) {
  const entry = await this.entriesService.findOne(id);
  if (entry.userId !== user.id) throw new ForbiddenException();
  return entry;
}
```

`listForUser(userId)`:
```sql
SELECT e.*, 
  (SELECT COUNT(*) FROM predictions p WHERE p."entryId" = e.id) AS predictions_count,
  (SELECT COALESCE(SUM("pointsEarned"), 0) FROM predictions WHERE "entryId" = e.id)
    + COALESCE((SELECT "totalPoints" FROM special_predictions WHERE "entryId" = e.id), 0) AS total_points,
  (SELECT EXISTS(SELECT 1 FROM special_predictions sp WHERE sp."entryId" = e.id AND sp."lockedAt" IS NOT NULL)) AS special_locked
FROM entries e
WHERE e."userId" = ? AND e.status = 'ACTIVE'
ORDER BY e.position ASC
```

Plus el rank de cada entry: query a la MV con WHERE entry_id IN (...).

**Commit:** `feat(backend/entries): GET /entries/me + /entries/:id with stats`

---

## Task 5.4 — PATCH /entries/:id (alias)

```typescript
@Patch(':id')
@UseGuards(JwtAuthGuard)
async updateAlias(...) {
  // Validar:
  //  - entry pertenece al user
  //  - special_prediction.lockedAt IS NULL (kickoff inaugural no pasó)
  //  - alias <= 60 chars
  // Update + audit log
}
```

**Commit:** `feat(backend/entries): PATCH /entries/:id (alias) with kickoff lock`

---

## Task 5.5 — Admin endpoints: max_entries config + entry visibility

**Files:**
- `admin.controller.ts`: agregar `GET /admin/entries` (listado) + `GET /admin/users/:id/entries`
- `configuration.controller.ts`: nueva key `max_entries_per_user` editable

**Commit:** `feat(backend/admin): /admin/entries listing + max_entries_per_user config`

---

## Task 5.6 — Predictions endpoints rebind

**File:** `backend/src/modules/predictions/predictions.controller.ts`

Cambios de paths:
- `POST /predictions/match/:matchId` → `POST /entries/:entryId/predictions/match/:matchId`
- `GET /predictions/me` → `GET /entries/:entryId/predictions`
- `POST /predictions/special` → `POST /entries/:entryId/special`
- `GET /predictions/special/me` → `GET /entries/:entryId/special`

Auth guard valida entryId pertenece al user.

**Commit:** `feat(backend/predictions): paths bind to entryId`

---

# FASE 6 — Backend tests refactor

**Goal:** tests passing al final. Estimado: 80-120 tests modificados.

## Task 6.1 — Test infrastructure helpers

**File:** `backend/src/test/helpers/factories.ts` (nuevo o existente)

Helpers para tests:
```typescript
export async function createUserWithEntry(prisma, overrides?) {
  const user = await prisma.user.create({ data: { ... } });
  const payment = await prisma.payment.create({ data: { userId: user.id, status: 'APPROVED', ... } });
  const entry = await prisma.entry.create({ data: { userId: user.id, paymentId: payment.id, position: 1 } });
  return { user, payment, entry };
}

export async function createUserWithMultipleEntries(prisma, count: number) { ... }
```

Reemplazar todos los `prisma.user.create + prisma.prediction.create({ userId })` con factory que use entry.

**Commit:** `test(backend): add user-with-entry factory`

---

## Task 6.2 — Update predictions tests

**Files:** todos los `*.spec.ts` que crean predictions con userId.

Buscar: `grep -rn "prisma.prediction.create\|prediction.userId\|user.predictions" backend/src --include="*.spec.ts"` → ~20-30 archivos.

Update todos.

**Commit:** `test(backend/predictions): migrate factories to entryId`

---

## Task 6.3 — Update scoring + leaderboard + leagues tests

**Commit:** `test(backend): migrate scoring/leaderboard/leagues tests to entryId`

---

## Task 6.4 — E2E test: agregar otro prode

**File:** `backend/src/test/e2e/multi-prode.e2e.spec.ts` (nuevo)

Cubre:
- User 1 crea cuenta vía flow público (Entry #1 creada)
- Login + POST /entries/init-payment con MockProvider
- Mock webhook → Entry #2 creada
- GET /entries/me retorna 2 entries
- Cap test: bajar config a 2, intentar crear 3ra → 409
- POST /entries/:entryId/predictions/match/:matchId → predicciones independientes por entry

**Commit:** `test(backend/e2e): multi-prode happy path + cap`

---

# FASE 7 — Frontend types + queryKeys

**Goal:** preparar types y queryKeys para multi-prode.

## Task 7.1 — types.ts: Entry + EntryStats

**File:** `frontend/lib/api/types.ts`

Agregar:
```typescript
export interface Entry {
  id: string;
  userId: string;
  position: number;
  alias: string | null;
  status: 'ACTIVE' | 'ANNULLED';
  createdAt: string;
  updatedAt: string;
}

export interface EntrySummary extends Entry {
  stats: {
    predictionsCount: number;
    totalPoints: number;
    rank: number | null;  // null si MV no refrescó aún o user no tiene predictions
    specialPredictionLocked: boolean;
  };
}
```

**Commit:** `feat(frontend/types): add Entry + EntrySummary types`

---

## Task 7.2 — queryKeys refactor

**File:** `frontend/lib/api/queryKeys.ts`

Cambios del spec §5.5: eliminar `predictions.me/forMatch/special`, agregar `entries.*`, renombrar `leaderboard.around → aroundEntry`.

**Commit:** `feat(frontend/api): queryKeys refactor for multi-entry`

---

# FASE 8 — Frontend ActiveEntryProvider + EntrySwitcher

## Task 8.1 — lib/api/entries.ts

**File:** `frontend/lib/api/entries.ts` (nuevo)

```typescript
export async function getMyEntries(): Promise<EntrySummary[]>;
export async function getEntry(id: string): Promise<EntrySummary>;
export async function updateEntryAlias(id: string, alias: string | null): Promise<EntrySummary>;
export async function initEntryPayment(dto: { alias?: string }): Promise<{ paymentId: string; initPoint: string }>;
```

**Commit:** `feat(frontend/api): entries module`

---

## Task 8.2 — ActiveEntryProvider

**File:** `frontend/providers/active-entry-provider.tsx`

Spec §5.1 + §5.6 (precedencia URL > localStorage > minPosition).

**Commit:** `feat(frontend/providers): ActiveEntryProvider`

---

## Task 8.3 — useActiveEntry hook

**File:** `frontend/lib/hooks/use-active-entry.ts`

**Commit:** `feat(frontend/hooks): useActiveEntry`

---

## Task 8.4 — EntrySwitcher component

**File:** `frontend/components/domain/entry-switcher.tsx`

Spec §5.2. Dropdown shadcn con la lista + CTA "+ Crear otro prode".

**Commit:** `feat(frontend/domain): EntrySwitcher dropdown`

---

## Task 8.5 — NewEntryModal component

**File:** `frontend/components/domain/new-entry-modal.tsx`

Spec §5.3. Form con alias + CTA pagar. Submit → `initEntryPayment` → redirect a initPoint.

**Commit:** `feat(frontend/domain): NewEntryModal`

---

# FASE 9 — Frontend pages migration

## Task 9.1 — AppLayout: agregar ActiveEntryProvider

**File:** `frontend/app/(app)/layout.tsx`

Wrap children con `<ActiveEntryProvider>`. Pasar el activeEntry al `<AppHeader>`.

**Commit:** `feat(frontend/layout): wrap (app) with ActiveEntryProvider`

---

## Task 9.2 — AppHeader: agregar EntrySwitcher

**File:** `frontend/components/layout/app-header.tsx`

Insertar `<EntrySwitcher>` entre el saludo y la nav central.

**Commit:** `feat(frontend/layout): AppHeader integrates EntrySwitcher`

---

## Task 9.3 — Predicciones pages: usar activeEntry

**Files:** `frontend/app/(app)/predicciones/page.tsx`, `[matchId]/page.tsx`

Queries cambian: `useActiveEntry().activeEntry.id` propagado a queryKeys + funciones API.

**Commit:** `refactor(frontend/predicciones): predictions queries use activeEntry`

---

## Task 9.4 — Especiales page: usar activeEntry

**Commit:** `refactor(frontend/especiales): special prediction uses entryId`

---

## Task 9.5 — Leaderboard page: render entries no users

**File:** `frontend/app/(app)/leaderboard/page.tsx`

Display name lógica del spec §3.2: `{firstName} {lastName} · {alias}` o `(#{position})` o sin sufijo.

`leaderboard.aroundEntry(activeEntry.id)` para el hero "POSICIÓN #N".

**Commit:** `refactor(frontend/leaderboard): render entries with display name logic`

---

## Task 9.6 — Ligas pages: membership por entry

**Files:** `frontend/app/(app)/ligas/{page,crear,unirme}.tsx`

Form "crear" pregunta cuál entry unir si user tiene >1.
Form "unirme" idem.

**Commit:** `refactor(frontend/ligas): membership por entry with picker`

---

# FASE 10 — Frontend tests + E2E

## Task 10.1 — Update unit tests

Tests de componentes que asumen 1 entry: agregar mocks con multi-entry.

**Commit:** `test(frontend): adapt unit tests for multi-entry`

---

## Task 10.2 — Update E2E tests existentes

**Files:** `frontend/tests/e2e/02-load-prediction.spec.ts`, etc.

Verificar que el flow single-entry sigue funcionando con el nuevo schema.

**Commit:** `test(frontend/e2e): keep single-entry flows green`

---

## Task 10.3 — Nuevo E2E: agregar segundo prode

**File:** `frontend/tests/e2e/06-multi-prode.spec.ts` (nuevo)

Login como user existente → click "+ Crear otro prode" → modal → MockCheckout APROBAR → verificar nuevo entry en EntrySwitcher → cargar predicción en el nuevo entry → ambos prodes en /leaderboard como rows separados.

**Commit:** `test(frontend/e2e): multi-prode happy path`

---

# FASE 11 — Deploy

## Task 11.1 — Docs deployment update

**File:** `docs/deployment.md`

Agregar sección "Multi-prode rollout":
- Pre-deploy: snapshot manual de BD
- Orden: M1 → backfill → backup orphans → delete orphans → M2 → frontend new build → restart
- Estimación de downtime: 5-10 min
- Rollback: snapshot restore si M2 falla

**Commit:** `docs(deploy): add multi-prode rollout procedure`

---

## Task 11.2 — Smoke test post-deploy

Manual:
1. Login user → ver 1 entry en switcher
2. Click "+ Crear otro prode" → completar flujo MP → ver 2 entries
3. Cargar predicción distinta en cada → /leaderboard muestra ambos
4. Crear mini-liga con entry #1 → invitar segundo user con su entry → ambos en ranking

**Commit:** ninguno (validation post-deploy).

---

# Integration Tests

```bash
cd backend && npm test -- --runInBand   # backend full suite
cd backend && npx playwright test        # E2E backend si aplica
cd frontend && npm test -- --run         # frontend unit
cd frontend && npx playwright test       # frontend E2E
```

# Manual Verification (post-implementation)

- User flow A (existing user): login → /predicciones (1 entry) → click "+" → MP mock → 2 entries
- User flow B (new user): registro público → 1 entry creada → login funciona
- Admin: ver users con entriesCount, ajustar max_entries_per_user
- Edge: bajar cap a 1, intentar crear segundo entry → 409

# Rollback Plan

Si algo crítico se rompe en producción post-deploy:

```bash
# 1. Redeploy backend al snapshot pre-M2 (Dokploy panel)
# 2. Restore BD desde snapshot manual pre-migración
docker exec prode-postgres pg_restore -U prode -d prode -c /tmp/prode_pre_multi_prode_*.dump

# 3. Frontend se queda con la versión nueva si ya está deployada — los endpoints `/entries/*` no existen, devolverán 404, pero la app no crashea (queries fallan, mensajes de error)
# 4. Si necesitamos rollback completo del frontend: revert al commit pre-multi-prode + redeploy
```

# Notas finales

- **No hay feature flag.** Backend + frontend van atómicos. En dev local podemos hacer commits intermedios pero el deploy a prod es un release single-shot.
- **Backups:** dump pre-M2 obligatorio. Backup tables de huérfanas se mantienen 30 días.
- **Tests rotos en mid-implementation son esperados.** El typecheck rompe entre Task 3.3 y la última de Fase 6 — eso es OK, lo importante es que al final compile y los tests pasen.
- **Coordinar con repaint Fase B:** si el repaint dark editorial está en curso cuando arranca multi-prode, mergear el repaint primero (no toca el schema). Si llega después, multi-prode crea componentes nuevos (EntrySwitcher, NewEntryModal) que ya nacen en dark editorial.

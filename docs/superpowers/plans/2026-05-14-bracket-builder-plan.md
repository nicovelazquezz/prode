# Bracket Builder + Knockout Tiebreakers — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-14-bracket-builder-design.md`
**Fecha:** 2026-05-14

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits
- Orden de rollout estricto: migration → backend (Prisma reads winner_team_id) → frontend

## Overview

Implementar el bracket builder universal (R32/R16/QF/SF/FINAL incluyendo 3er puesto) con tabla de grupos calculada como referencia, agregar `winnerTeamId` opcional en `Match` para resolver empates de eliminatoria sin tocar el sistema de puntos, y limpiar `/admin/fases` de botones rotos.

## Prerequisites

- [ ] Branch nueva desde `main`: `git checkout -b feat/bracket-builder`
- [ ] DB local corriendo (`docker compose up -d postgres redis`)
- [ ] Backend test runner OK: `cd backend && pnpm test --runInBand --testPathPattern=group` (debería decir "no tests found" antes de empezar)

## Fases

### Fase A — Schema + migration
Una sola tarea, deploy antes que cualquier otro código.

### Fase B — Backend lógica de empates y plumbing
Tasks: 2-5. Sin endpoints nuevos, solo extiende lo existente.

### Fase C — Backend standings + builder
Tasks: 6-9. Endpoints nuevos.

### Fase D — Frontend types + cliente API
Tasks: 10-11.

### Fase E — Frontend pantallas
Tasks: 12-15.

### Fase F — Smoke + commit final

---

## Tasks

### Task 1: Migration `winner_team_id`

**File (modify):** `backend/prisma/schema.prisma`
**Migration:** `backend/prisma/migrations/<timestamp>_add_match_winner_team_id/migration.sql`

#### Implementation

En `schema.prisma` dentro del `model Match`, después de `awayTeam` (alrededor de línea 217):

```prisma
  winnerTeamId String?
  winnerTeam   Team?   @relation("MatchWinner", fields: [winnerTeamId], references: [id], onDelete: SetNull)
```

En `model Team` (alrededor de línea 88), después de `matchesAsAway`:

```prisma
  matchesAsWinner Match[] @relation("MatchWinner")
```

#### Generate migration

```bash
cd backend && pnpm prisma migrate dev --name add_match_winner_team_id
```

Confirmar que el SQL generado es solo `ALTER TABLE matches ADD COLUMN winner_team_id TEXT;` + el FK constraint. **No** debería haber un rewrite del tabla porque la columna admite NULL.

#### Verification

```bash
cd backend && pnpm prisma migrate status
# Expected: "Database schema is up to date!"
cd backend && pnpm prisma generate
# Expected: regenera el cliente con Match.winnerTeamId
```

**Commit:** `feat(db): add winner_team_id to matches`

---

### Task 2: `pickTeam` respeta `winnerTeamId`

**File:** `backend/src/modules/scoring/match-progression.service.ts`
**Test:** `backend/src/modules/scoring/match-progression.service.integration.spec.ts` (extender)

#### Test First (RED)

En el spec existente, agregar describe block:

```typescript
describe('pickTeam with winnerTeamId (knockout ties)', () => {
  it('uses winnerTeamId when scores are tied (winner path)', async () => {
    // Carve a R32 match, finalize with 1-1 and winnerTeamId=home
    // Then populate R16 — verify the home team appears as a R16 team
  });

  it('uses winnerTeamId for loser path (THIRD_PLACE population)', async () => {
    // Similar setup, pickFromLoser=true → returns away when winnerTeamId=home
  });

  it('returns null when scores are tied AND winnerTeamId is null (legacy alert behavior)', async () => {
    // Verify the AdminAlerts notify still fires
  });
});
```

Tests deben fallar antes de implementar.

#### Implementation (GREEN)

Reemplazar el método `pickTeam` (líneas 259-267):

```typescript
private pickTeam(match: Match, fromLoser: boolean): string | null {
  if (match.scoreHome === null || match.scoreAway === null) return null;
  if (match.scoreHome === match.scoreAway) {
    if (!match.winnerTeamId) return null;
    if (fromLoser) {
      return match.winnerTeamId === match.homeTeamId
        ? match.awayTeamId
        : match.homeTeamId;
    }
    return match.winnerTeamId;
  }
  const homeWon = match.scoreHome > match.scoreAway;
  if (fromLoser) return homeWon ? match.awayTeamId : match.homeTeamId;
  return homeWon ? match.homeTeamId : match.awayTeamId;
}
```

#### Verification

```bash
cd backend && pnpm test --runInBand --testPathPattern=match-progression.service.integration
# Expected: nuevos tests passing + los existentes intactos
```

**Commit:** `feat(scoring): pickTeam respects winnerTeamId for tied knockouts`

---

### Task 3: `FinishMatchDto` extension + validación en service

**Files:**
- `backend/src/modules/scoring/dto/finish-match.dto.ts`
- `backend/src/modules/scoring/scoring.service.ts`

**Test:** `backend/src/modules/scoring/scoring.service.integration.spec.ts` (extender)

#### Test First (RED)

```typescript
describe('finishMatchAndScore winnerTeamId validation', () => {
  it('rejects tied knockout without winnerTeamId', async () => {
    // Setup: an R32 match with two teams
    // Call finishMatchAndScore(matchId, 1, 1, adminId)  // no winnerTeamId
    // Expect BadRequestException
  });

  it('rejects winnerTeamId that is not home or away', async () => {
    // Same setup, pass winnerTeamId=<random other team id>
    // Expect BadRequestException
  });

  it('accepts tied knockout with valid winnerTeamId', async () => {
    // Setup R32 match, finish 1-1 with winnerTeamId=homeTeamId
    // Verify match persists winnerTeamId
  });

  it('ignores winnerTeamId when scores differ', async () => {
    // Finish 2-1 with winnerTeamId set; verify column stays null
  });

  it('does not require winnerTeamId in GROUPS phase even on tie', async () => {
    // Finish a GROUPS match 1-1 without winnerTeamId — should succeed
  });
});
```

#### Implementation (GREEN)

**`finish-match.dto.ts`** (reemplazar archivo entero):

```typescript
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body of `POST /admin/matches/:id/finish` and `POST /admin/matches/:id/recalculate`.
 *
 * `winnerTeamId` solo aplica cuando phase != GROUPS y scoreHome === scoreAway
 * (empate de eliminatoria). Para el resto de casos se ignora.
 */
export class FinishMatchDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  scoreHome!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  scoreAway!: number;

  @IsOptional()
  @IsString()
  winnerTeamId?: string;
}
```

**`scoring.controller.ts`** — pasar `winnerTeamId` a service. En el handler `finish` (~línea 47):

```typescript
return this.scoringService.finishMatchAndScore(
  matchId,
  dto.scoreHome,
  dto.scoreAway,
  req.user.sub,
  dto.winnerTeamId,
);
```

Mismo cambio en el handler `recalculate` (~línea 73).

**`scoring.service.ts`** — Agregar `winnerTeamId?: string` al signature de `finishMatchAndScore` y `recalculateMatch`, y antes de la TX validar:

```typescript
// En finishMatchAndScore, después del pre-check de status:
if (matchPrev.phase !== 'GROUPS' && scoreHome === scoreAway) {
  if (!winnerTeamId) {
    throw new BadRequestException('winnerTeamId requerido para empate en eliminatoria');
  }
  if (winnerTeamId !== matchPrev.homeTeamId && winnerTeamId !== matchPrev.awayTeamId) {
    throw new BadRequestException('winnerTeamId debe ser uno de los equipos del partido');
  }
}
const effectiveWinnerTeamId = scoreHome === scoreAway ? winnerTeamId ?? null : null;
```

Dentro de la TX, en el `update` del match (~línea 104), agregar `winnerTeamId: effectiveWinnerTeamId` al data. Mismo patrón en `recalculateMatch`.

#### Verification

```bash
cd backend && pnpm test --runInBand --testPathPattern=scoring.service.integration
# Expected: nuevos tests passing, los existentes (12+ tests) siguen verdes
cd backend && pnpm typecheck
# Expected: 0 errors
```

**Commit:** `feat(scoring): require winnerTeamId on tied knockouts`

---

### Task 4: `matches.service.ts` include `winnerTeam`

**File:** `backend/src/modules/matches/matches.service.ts`

#### Implementation

En cuatro lugares del archivo (líneas 132, 159, 172, 183 al momento de escribir el plan — verificar al editar), reemplazar:

```typescript
include: { homeTeam: true, awayTeam: true },
```

por:

```typescript
include: { homeTeam: true, awayTeam: true, winnerTeam: true },
```

**NO** tocar el quinto include (línea 514, en admin create) — un match recién creado no tiene `winnerTeam`.

#### Verification

```bash
cd backend && pnpm typecheck
# Expected: 0 errors
cd backend && curl -s http://localhost:3000/matches/upcoming | jq '.[0] | keys'
# Expected: el response incluye "winnerTeam" entre las keys (probablemente null)
```

**Commit:** `feat(matches): include winnerTeam in public match responses`

---

### Task 5: Cleanup de imports y typecheck

Asegurarse de que después de los cambios de Tasks 1-4 todo compila:

```bash
cd backend && pnpm typecheck && pnpm lint
# Expected: 0 errors
cd backend && pnpm test --runInBand
# Expected: full suite passes (~200 tests)
```

Si todo verde, commit + push para empezar a desplegar la migration en staging.

**Commit:** (solo si hay cambios pendientes) `chore: cleanup after winnerTeamId integration`

---

### Task 6: `GroupStandingsService`

**File (new):** `backend/src/modules/scoring/group-standings.service.ts`
**Test (new):** `backend/src/modules/scoring/group-standings.service.spec.ts`

#### Test First (RED)

```typescript
import { GroupStandingsService } from './group-standings.service.js';

describe('GroupStandingsService', () => {
  // Use a mock PrismaService that returns canned matches.
  it('computes PJ/PG/PE/PP/GF/GC/DG/PTS over 6 FINISHED matches of a group', async () => {
    // Fixture: group A with Argentina, Mexico, Polonia, Saudi.
    // Matches:
    //   ARG 2-0 SAU → ARG 3pts +2, SAU 0pts -2
    //   MEX 1-1 POL → both 1pt 0
    //   ARG 2-1 MEX → ARG 6pts +3, MEX 1pt -1
    //   POL 2-0 SAU → POL 4pts +1, SAU 0pts -4
    //   ARG 1-1 POL → ARG 7pts +3, POL 5pts +1
    //   MEX 2-1 SAU → MEX 4pts 0, SAU 0pts -5
    // Expected order: ARG (7), POL (5), MEX (4), SAU (0)
  });

  it('orders by PTS DESC → DG DESC → GF DESC', async () => {
    // Construct fixture where two teams have same PTS but different DG.
  });

  it('returns 4 teams with all-zero stats when group has 0 finished matches', async () => {
    // Empty group → 4 teams, position assigned 1..4 by team id stable order.
  });

  it('handles partial groups (3 of 6 matches finished)', async () => {
    // Half-played fixture.
  });
});
```

#### Implementation (GREEN)

Service que consulta los matches del grupo y reduce. Estructura:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

export interface GroupStanding {
  teamId: string;
  teamName: string;
  teamShortName: string;
  teamFlagUrl: string;
  pj: number;
  pg: number;
  pe: number;
  pp: number;
  gf: number;
  gc: number;
  dg: number;
  pts: number;
  position: number;
}

@Injectable()
export class GroupStandingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getGroupStandings(groupCode: string): Promise<GroupStanding[]> {
    const teams = await this.prisma.team.findMany({
      where: { groupCode },
      orderBy: { id: 'asc' },
    });
    const matches = await this.prisma.match.findMany({
      where: { phase: 'GROUPS', groupCode, status: 'FINISHED' },
    });
    // Reduce matches into per-team stats.
    const stats = new Map<string, Omit<GroupStanding, 'position'>>();
    for (const t of teams) {
      stats.set(t.id, {
        teamId: t.id,
        teamName: t.name,
        teamShortName: t.shortName,
        teamFlagUrl: t.flagUrl,
        pj: 0, pg: 0, pe: 0, pp: 0,
        gf: 0, gc: 0, dg: 0, pts: 0,
      });
    }
    for (const m of matches) {
      if (m.homeTeamId === null || m.awayTeamId === null) continue;
      if (m.scoreHome === null || m.scoreAway === null) continue;
      const h = stats.get(m.homeTeamId);
      const a = stats.get(m.awayTeamId);
      if (!h || !a) continue;
      h.pj++; a.pj++;
      h.gf += m.scoreHome; h.gc += m.scoreAway;
      a.gf += m.scoreAway; a.gc += m.scoreHome;
      if (m.scoreHome > m.scoreAway) { h.pg++; a.pp++; h.pts += 3; }
      else if (m.scoreHome < m.scoreAway) { a.pg++; h.pp++; a.pts += 3; }
      else { h.pe++; a.pe++; h.pts++; a.pts++; }
    }
    const arr = Array.from(stats.values()).map((s) => ({
      ...s,
      dg: s.gf - s.gc,
    }));
    arr.sort((x, y) =>
      y.pts - x.pts || y.dg - x.dg || y.gf - x.gf
    );
    return arr.map((s, i) => ({ ...s, position: i + 1 }));
  }

  async getAllGroupStandings(): Promise<Record<string, GroupStanding[]>> {
    const groupCodes = await this.prisma.team.findMany({
      where: { groupCode: { not: null } },
      select: { groupCode: true },
      distinct: ['groupCode'],
    });
    const out: Record<string, GroupStanding[]> = {};
    for (const { groupCode } of groupCodes) {
      if (!groupCode) continue;
      out[groupCode] = await this.getGroupStandings(groupCode);
    }
    return out;
  }
}
```

Registrar el provider en `scoring.module.ts`.

#### Verification

```bash
cd backend && pnpm test --runInBand --testPathPattern=group-standings.service
# Expected: 4 tests passing
```

**Commit:** `feat(scoring): GroupStandingsService computes group tables`

---

### Task 7: `GET /groups/standings` endpoint público

**File (new):** `backend/src/modules/scoring/groups.controller.ts`
**Test (new):** `backend/src/modules/scoring/groups.controller.spec.ts`

#### Test First (RED)

```typescript
describe('GET /groups/standings', () => {
  it('returns 12 groups with computed standings', async () => {
    // Hit endpoint, expect Record<string, GroupStanding[]>
    // Verify 12 keys (A..L), each with 4 teams sorted
  });

  it('respects 60s cache', async () => {
    // Spy on service, hit twice within 60s, expect 1 service call
  });
});
```

#### Implementation (GREEN)

```typescript
import { Controller, Get, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { Public } from '../../common/decorators/public.decorator.js';
import { GroupStandingsService, GroupStanding } from './group-standings.service.js';

const STANDINGS_CACHE_KEY = 'groups:standings:all';
const STANDINGS_TTL_MS = 60_000;

@Controller('groups')
export class GroupsController {
  constructor(
    private readonly service: GroupStandingsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  @Public()
  @Get('standings')
  async standings(): Promise<Record<string, GroupStanding[]>> {
    const cached = await this.cache.get<Record<string, GroupStanding[]>>(STANDINGS_CACHE_KEY);
    if (cached) return cached;
    const fresh = await this.service.getAllGroupStandings();
    await this.cache.set(STANDINGS_CACHE_KEY, fresh, STANDINGS_TTL_MS);
    return fresh;
  }
}
```

Registrar en `scoring.module.ts`.

Agregar invalidación en `scoring.service.ts` — en `finishMatchAndScore` y `recalculateMatch`, después del POST-COMMIT side effects bloque:

```typescript
if (matchPrev.phase === 'GROUPS') {
  await this.cache.del('groups:standings:all');
}
```

(Requiere inyectar `CACHE_MANAGER` en `ScoringService` si no lo tiene ya.)

#### Verification

```bash
cd backend && pnpm test --runInBand --testPathPattern=groups.controller
curl -s http://localhost:3000/groups/standings | jq 'keys'
# Expected: ["A","B","C","D","E","F","G","H","I","J","K","L"] (los 12 grupos)
```

**Commit:** `feat(scoring): GET /groups/standings public endpoint with cache`

---

### Task 8: Builder GET endpoint

**File (new):** `backend/src/modules/admin/admin-fases-builder.controller.ts`
**Test (new):** `backend/src/modules/admin/admin-fases-builder.controller.integration.spec.ts`

#### Test First (RED)

```typescript
describe('GET /admin/fases/builder/:phase', () => {
  it('returns matches + groups reference for ROUND_32', async () => {
    // Verify reference.type === 'GROUPS', standings populated
    // Verify matches array has 16 entries (matchNumbers 73-88)
  });

  it('returns matches + previous round reference for ROUND_16', async () => {
    // Verify reference.type === 'PREVIOUS_ROUND', 16 R32 matches listed
  });

  it('returns BOTH THIRD_PLACE and FINAL matches when phase=FINAL', async () => {
    // Verify 2 matches in response, matchPhase distinguishes them
  });

  it('rejects phase=THIRD_PLACE with 400', async () => {
    // GET /admin/fases/builder/THIRD_PLACE → 400
  });

  it('rejects phase=GROUPS with 400', async () => {
    // Similar
  });

  it('requires admin role', async () => {
    // No token → 401
  });
});
```

#### Implementation (GREEN)

Controller scope: `@Controller('admin/fases/builder')`, `@UseGuards(RolesGuard) @Roles('ADMIN')`.

```typescript
type BuilderPhase = 'ROUND_32' | 'ROUND_16' | 'QUARTERS' | 'SEMIS' | 'FINAL';
const VALID_PHASES: BuilderPhase[] = ['ROUND_32', 'ROUND_16', 'QUARTERS', 'SEMIS', 'FINAL'];

@Get(':phase')
async getBuilder(@Param('phase') phase: string): Promise<BuilderState> {
  if (!VALID_PHASES.includes(phase as BuilderPhase)) {
    throw new BadRequestException(
      phase === 'THIRD_PLACE'
        ? 'THIRD_PLACE se administra junto con FINAL'
        : `phase ${phase} no es válida para el builder`,
    );
  }
  const matchPhases: Phase[] = phase === 'FINAL' ? ['THIRD_PLACE', 'FINAL'] : [phase as Phase];
  const matches = await this.prisma.match.findMany({
    where: { phase: { in: matchPhases } },
    orderBy: { matchNumber: 'asc' },
  });
  let reference: Reference;
  if (phase === 'ROUND_32') {
    reference = { type: 'GROUPS', standings: await this.standings.getAllGroupStandings() };
  } else {
    const previousPhase = PREVIOUS_PHASE_MAP[phase as BuilderPhase];
    const prevMatches = await this.prisma.match.findMany({
      where: { phase: previousPhase },
      include: { homeTeam: true, awayTeam: true, winnerTeam: true },
      orderBy: { matchNumber: 'asc' },
    });
    reference = { type: 'PREVIOUS_ROUND', previousPhase, matches: prevMatches.map(toPrevRef) };
  }
  return {
    phase: phase as BuilderPhase,
    matches: matches.map((m) => ({
      matchId: m.id,
      matchNumber: m.matchNumber,
      matchPhase: m.phase,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeTeamLabel: m.homeTeamLabel,
      awayTeamLabel: m.awayTeamLabel,
      kickoffAt: m.kickoffAt.toISOString(),
      venue: m.venue,
    })),
    reference,
  };
}
```

Donde `PREVIOUS_PHASE_MAP = { ROUND_16: 'ROUND_32', QUARTERS: 'ROUND_16', SEMIS: 'QUARTERS', FINAL: 'SEMIS' }` y `toPrevRef` mapea Match con relaciones a la shape del spec (loser se calcula desde scores + winnerTeamId).

#### Verification

```bash
cd backend && pnpm test --runInBand --testPathPattern=admin-fases-builder
```

**Commit:** `feat(admin): GET /admin/fases/builder/:phase`

---

### Task 9: Builder POST endpoint

**File:** `backend/src/modules/admin/admin-fases-builder.controller.ts` (extender)
**DTO (new):** `backend/src/modules/admin/dto/builder-apply.dto.ts`
**Test:** extender el spec de Task 8

#### Test First (RED)

```typescript
describe('POST /admin/fases/builder/:phase', () => {
  it('persists 16 R32 cruces and sets predictionsOpenAt', async () => {
    // POST with 16 valid pairs → 200
    // Each match has homeTeamId, awayTeamId, predictionsOpenAt now
  });

  it('rejects duplicate team across crosses', async () => {
    // Two cruces with same team → 400
  });

  it('rejects home === away', async () => {
    // 400
  });

  it('idempotent: re-applying same body returns matchesUpdated=0', async () => {
    // POST twice, second response shows 0 updates, no new audit log
  });

  it('does not reset predictionsOpenAt on overwrite', async () => {
    // Match with predictionsOpenAt set, change team, expect predictionsOpenAt unchanged
  });

  it('writes audit log only when there are real diffs', async () => {
    // No diffs → no audit log
  });
});
```

#### Implementation (GREEN)

DTO:

```typescript
import { IsArray, IsString, IsOptional, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class BuilderApplyMatchDto {
  @IsString() matchId!: string;
  @IsOptional() @IsString() homeTeamId?: string | null;
  @IsOptional() @IsString() awayTeamId?: string | null;
}

export class BuilderApplyDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => BuilderApplyMatchDto) @ArrayMinSize(1)
  matches!: BuilderApplyMatchDto[];
}
```

Handler:

```typescript
@Post(':phase')
async applyBuilder(
  @Param('phase') phase: string,
  @Body() dto: BuilderApplyDto,
  @CurrentUser() user: AuthenticatedUser,
): Promise<{ ok: true; matchesUpdated: number }> {
  if (!VALID_PHASES.includes(phase as BuilderPhase)) throw new BadRequestException(...);

  // Validations
  const seen = new Set<string>();
  for (const m of dto.matches) {
    if (m.homeTeamId && m.awayTeamId && m.homeTeamId === m.awayTeamId) {
      throw new BadRequestException(`Match ${m.matchId}: home === away`);
    }
    for (const tid of [m.homeTeamId, m.awayTeamId].filter(Boolean) as string[]) {
      if (seen.has(tid)) throw new BadRequestException(`Equipo ${tid} repetido en la fase`);
      seen.add(tid);
    }
  }

  const matchPhases: Phase[] = phase === 'FINAL' ? ['THIRD_PLACE', 'FINAL'] : [phase as Phase];
  const validMatchIds = new Set(
    (await this.prisma.match.findMany({
      where: { phase: { in: matchPhases } },
      select: { id: true },
    })).map((m) => m.id),
  );
  for (const m of dto.matches) {
    if (!validMatchIds.has(m.matchId)) {
      throw new BadRequestException(`Match ${m.matchId} no pertenece a fase ${phase}`);
    }
  }

  // Apply in TX
  let updated = 0;
  const diffs: Array<{ matchId: string; before: any; after: any }> = [];
  const now = new Date();
  await this.prisma.$transaction(async (tx) => {
    for (const m of dto.matches) {
      const current = await tx.match.findUniqueOrThrow({ where: { id: m.matchId } });
      const nextHome = m.homeTeamId ?? null;
      const nextAway = m.awayTeamId ?? null;
      if (current.homeTeamId === nextHome && current.awayTeamId === nextAway) continue;
      const shouldOpenPredictions =
        current.predictionsOpenAt === null && nextHome !== null && nextAway !== null;
      await tx.match.update({
        where: { id: m.matchId },
        data: {
          homeTeamId: nextHome,
          awayTeamId: nextAway,
          ...(shouldOpenPredictions ? { predictionsOpenAt: now } : {}),
        },
      });
      diffs.push({
        matchId: m.matchId,
        before: { homeTeamId: current.homeTeamId, awayTeamId: current.awayTeamId },
        after: { homeTeamId: nextHome, awayTeamId: nextAway },
      });
      updated++;
    }
    if (updated > 0) {
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'phase.builder.applied',
          entity: 'phase',
          entityId: phase,
          changes: { matches: diffs },
        },
      });
    }
  });

  return { ok: true, matchesUpdated: updated };
}
```

#### Verification

```bash
cd backend && pnpm test --runInBand --testPathPattern=admin-fases-builder
# Expected: all tests passing
cd backend && pnpm typecheck
```

**Commit:** `feat(admin): POST /admin/fases/builder/:phase`

---

### Task 10: Frontend types + API client

**Files:**
- `frontend/lib/api/types.ts` (extender `Match` con `winnerTeam`)
- `frontend/lib/api/admin.ts` (agregar funciones + tipos)
- `frontend/lib/api/queryKeys.ts` (agregar keys del builder y standings)

#### Implementation

En `types.ts`, agregar a `Match`:

```typescript
winnerTeam?: Team | null;
winnerTeamId?: string | null;
```

En `admin.ts`, agregar:

```typescript
export interface GroupStanding {
  teamId: string; teamName: string; teamShortName: string; teamFlagUrl: string;
  pj: number; pg: number; pe: number; pp: number;
  gf: number; gc: number; dg: number; pts: number; position: number;
}

export type BuilderPhase = 'ROUND_32' | 'ROUND_16' | 'QUARTERS' | 'SEMIS' | 'FINAL';

export interface BuilderMatch {
  matchId: string;
  matchNumber: number;
  matchPhase: Phase;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamLabel: string | null;
  awayTeamLabel: string | null;
  kickoffAt: string;
  venue: string | null;
}

export type Reference =
  | { type: 'GROUPS'; standings: Record<string, GroupStanding[]> }
  | { type: 'PREVIOUS_ROUND'; previousPhase: Phase; matches: PreviousRoundMatch[] };

export interface PreviousRoundMatch { /* shape del spec */ }

export interface BuilderState {
  phase: BuilderPhase;
  matches: BuilderMatch[];
  reference: Reference;
}

export async function getBuilderState(phase: BuilderPhase): Promise<BuilderState> {
  return api.get(`admin/fases/builder/${phase}`).json<BuilderState>();
}

export async function applyBuilder(
  phase: BuilderPhase,
  matches: Array<{ matchId: string; homeTeamId: string | null; awayTeamId: string | null }>,
): Promise<{ ok: true; matchesUpdated: number }> {
  return api.post(`admin/fases/builder/${phase}`, { json: { matches } }).json();
}
```

En `finishMatch` agregar `winnerTeamId?: string` al body.

**Borrar** las funciones `closePhase` y `markPrizePaid` y sus imports.

En `queryKeys.ts`:

```typescript
fases: {
  builder: (phase: string) => ["admin", "fases", "builder", phase] as const,
  groupStandings: () => ["groups", "standings"] as const,
},
```

#### Verification

```bash
cd frontend && pnpm typecheck
# Expected: 0 errors (puede haber 1-2 en /admin/fases que se arreglan en Task 14)
```

**Commit:** `feat(frontend): types + API client for bracket builder`

---

### Task 11: Form de finalizar partido — select Ganador

**File:** `frontend/app/(admin)/admin/partidos/[id]/page.tsx`

#### Implementation

En el component `FinishMatchDialog` (definido alrededor de línea 555 — confirmar nombre real al editar):

1. Agregar state local:
```typescript
const [winnerTeamId, setWinnerTeamId] = useState<string | null>(null);
```

2. Calcular si aplica:
```typescript
const isKnockout = match.phase !== 'GROUPS';
const isTied = scoreHome !== null && scoreAway !== null && scoreHome === scoreAway;
const requiresWinner = isKnockout && isTied;
```

3. Renderizar select cuando `requiresWinner` y ambos equipos están asignados:
```tsx
{requiresWinner && match.homeTeam && match.awayTeam ? (
  <div className="mt-4">
    <label className="font-sans text-xs uppercase tracking-wider text-[var(--color-landing-text-muted)]">
      Ganador (definición por penales/decisión)
    </label>
    <select
      value={winnerTeamId ?? ''}
      onChange={(e) => setWinnerTeamId(e.target.value || null)}
      className="mt-1 w-full ..."
    >
      <option value="">— elegir —</option>
      <option value={match.homeTeam.id}>{match.homeTeam.name}</option>
      <option value={match.awayTeam.id}>{match.awayTeam.name}</option>
    </select>
  </div>
) : null}
```

4. Actualizar `canSubmit`:
```typescript
const canSubmit = scoreHome !== null && scoreAway !== null && (!requiresWinner || winnerTeamId !== null);
```

5. Pasar `winnerTeamId` a `finishMatch`:
```typescript
finishMatch(match.id, {
  scoreHome: scoreHome ?? 0,
  scoreAway: scoreAway ?? 0,
  winnerTeamId: requiresWinner ? winnerTeamId ?? undefined : undefined,
});
```

6. Reset incluye `setWinnerTeamId(null)`.

#### Verification

Manual smoke en `/admin/partidos/[id]` (cualquier R32 match): cargar 1-1 → debe aparecer select. Cargar 2-1 → select no aparece.

**Commit:** `feat(admin): require winnerTeamId in finish form for tied knockouts`

---

### Task 12: Builder page `/admin/fases/builder/[phase]`

**File (new):** `frontend/app/(admin)/admin/fases/builder/[phase]/page.tsx`
**Subcomponents (new, opcional):** `frontend/components/admin/builder/groups-reference.tsx`, `previous-round-reference.tsx`, `builder-rows.tsx`

#### Implementation

Server component arriba que valide el phase, después client component con la UI.

```tsx
// page.tsx (server)
import { redirect, notFound } from 'next/navigation';
import { BuilderClient } from './builder-client';

const VALID: BuilderPhase[] = ['ROUND_32', 'ROUND_16', 'QUARTERS', 'SEMIS', 'FINAL'];

export default function Page({ params }: { params: { phase: string } }) {
  if (params.phase === 'THIRD_PLACE') redirect('/admin/fases/builder/FINAL');
  if (!VALID.includes(params.phase as BuilderPhase)) notFound();
  return <BuilderClient phase={params.phase as BuilderPhase} />;
}
```

`builder-client.tsx`:

```tsx
'use client';
export function BuilderClient({ phase }: { phase: BuilderPhase }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.fases.builder(phase),
    queryFn: () => getBuilderState(phase),
  });
  const [rows, setRows] = useState<BuilderRow[]>([]);
  useEffect(() => {
    if (data) setRows(data.matches.map(m => ({ ...m })));
  }, [data]);

  // Compute conflicts (duplicates, home===away)
  const conflicts = computeConflicts(rows);
  const canSave = conflicts.length === 0 && rows.some(r => /* has diff vs data */);

  const apply = useMutation({
    mutationFn: () => applyBuilder(phase, rows.map(r => ({
      matchId: r.matchId, homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId,
    }))),
    onSuccess: (res) => {
      toast.success(`${res.matchesUpdated} cruces guardados`);
      qc.invalidateQueries({ queryKey: queryKeys.admin.matches.all() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.fases.builder(phase) });
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
      <aside>
        {data?.reference.type === 'GROUPS'
          ? <GroupsReference standings={data.reference.standings} />
          : data?.reference.type === 'PREVIOUS_ROUND'
            ? <PreviousRoundReference {...data.reference} />
            : null}
      </aside>
      <main>
        <BuilderRows rows={rows} setRows={setRows} conflicts={conflicts} />
        <div className="sticky bottom-0 mt-4 p-4 bg-surface">
          <Button onClick={() => apply.mutate()} disabled={!canSave || apply.isPending}>
            Guardar cruces
          </Button>
        </div>
      </main>
    </div>
  );
}
```

**Subcomponents:**

- `GroupsReference`: render 12 cards, cada uno con tabla 4 filas. Bajo el listado, panel "Mejores terceros" con los 12 equipos ordenados y los primeros 8 marcados.
- `PreviousRoundReference`: lista de matches con score + winner badge.
- `BuilderRows`: N filas con `TeamPicker` para home y away, badge de estado, highlight rojo si hay conflicto.

Para los selects de equipos, reutilizar `TeamPicker` que ya existe (verificar import path).

#### Verification

Manual:

1. Navegar a `/admin/fases/builder/ROUND_32` con fixtures de grupos cargados.
2. Verificar que la referencia muestra los 12 grupos con tabla.
3. Asignar 16 cruces → "Guardar" → toast OK.
4. Refrescar página → cruces persisten.
5. Editar uno y volver a guardar → "1 cruces guardados".
6. Probar duplicar un equipo → botón deshabilitado, highlight rojo.

**Commit:** `feat(admin): bracket builder page for knockout phases`

---

### Task 13: `/admin/fases` cleanup

**File:** `frontend/app/(admin)/admin/fases/page.tsx`

#### Implementation

1. **Borrar:**
   - Componente `ClosePhaseDialog` entero.
   - Botón "Cerrar fase" en `PhaseCard`.
   - Componente `PrizesList` puede quedar pero sin el botón "Marcar pagado" ni la mutación `payMutation`.
   - `closeMutation`, `payMutation`, imports `closePhase`, `markPrizePaid`.
   - Tipos `GENERAL_FIRST/SECOND/THIRD` de `PRIZE_LABELS` (dejar solo `PHASE_WINNER`).
   - Todo el copy de WhatsApp en el dialog (que ya no existe).

2. **Agregar:** en `PhaseCard`, después del top 5, un link a `/admin/fases/builder/[phase]`:

```tsx
const KNOCKOUT_PHASES: Phase[] = ['ROUND_32', 'ROUND_16', 'QUARTERS', 'SEMIS', 'FINAL'];
// THIRD_PLACE no link — se administra desde FINAL

const showBuilderLink = KNOCKOUT_PHASES.includes(summary.phase);
const canEnterBuilder = /* logic: previous phase closed, or phase==='ROUND_32' && GROUPS closed */;

{showBuilderLink ? (
  <Link
    href={canEnterBuilder ? `/admin/fases/builder/${summary.phase}` : '#'}
    aria-disabled={!canEnterBuilder}
    className={canEnterBuilder ? '...' : '... opacity-50 pointer-events-none'}
  >
    Armar cruces
  </Link>
) : null}
```

3. **Eliminar también** las definiciones de `closePhase` y `markPrizePaid` en `frontend/lib/api/admin.ts` (ya marcado en Task 10).

#### Verification

```bash
cd frontend && pnpm typecheck && pnpm lint
# Expected: 0 errors
```

Manual: abrir `/admin/fases` → ya no aparece "Cerrar fase" ni "Marcar pagado". En cada card eliminatoria aparece "Armar cruces".

**Commit:** `refactor(admin): cleanup /admin/fases + add builder links`

---

### Task 14: Vista pública del partido empatado

**Files (identificar al editar):**
- Componente que renderiza un partido en `/partidos` listado.
- Componente que renderiza partido individual.

Búsqueda inicial:

```bash
grep -rn "scoreHome\|scoreAway" frontend/components frontend/app/\(app\) --include="*.tsx" -l
```

#### Implementation

En cada componente que muestra el resultado de un partido FINISHED, agregar:

```tsx
{match.status === 'FINISHED' && match.winnerTeam ? (
  <p className="mt-1 font-mono text-xs text-[var(--color-landing-text-muted)]">
    Pasa {match.winnerTeam.name}
  </p>
) : null}
```

#### Verification

Manual: navegar al detalle/listado de un partido empatado finalizado → debe mostrar "Pasa X".

**Commit:** `feat(frontend): show 'Pasa X' on tied finished knockouts`

---

### Task 15: Smoke + final commit

```bash
cd backend && pnpm typecheck && pnpm test --runInBand
cd frontend && pnpm typecheck && pnpm lint && pnpm build
```

Expected: todo verde. Si rompe algo, fix antes de marcar el plan como completo.

---

## Integration tests (end-to-end)

Después de todas las tasks, en staging:

1. **Flujo R32:**
   - Finalizar los 72 partidos de grupos (puede ser con script o manualmente).
   - GROUPS se cierra automáticamente.
   - Abrir `/admin/fases/builder/ROUND_32`.
   - Verificar tabla de grupos correcta.
   - Asignar 16 cruces → guardar.
   - Verificar predictionsOpenAt seteado en los 16 matches.
   - Hacer una predicción como usuario → OK.

2. **Flujo empate eliminatoria:**
   - Finalizar R32 #73 con 1-1 sin `winnerTeamId` → error 400.
   - Finalizar con `winnerTeamId = home` → OK.
   - Verificar `winnerTeam` aparece en `GET /matches/73` response.
   - Cargar la vista pública del partido → muestra "Pasa <home>".

3. **Flujo R16 builder:**
   - Después de finalizar los 16 R32 (con empates resueltos), R32 se cierra y popula R16 automáticamente.
   - Abrir `/admin/fases/builder/ROUND_16`.
   - Verificar que los 8 cruces vienen pre-rellenados con los ganadores.
   - Si hay un cruce empatado sin winnerTeamId, mostrarse como incompleto.

## Manual verification

Antes de mergear a main:

- [ ] `/admin/fases` ya no tiene "Cerrar fase" ni "Marcar pagado".
- [ ] `/admin/fases` muestra "Armar cruces" en cards de fase eliminatoria (excepto THIRD_PLACE).
- [ ] `/admin/fases/builder/ROUND_32` carga con tabla de grupos.
- [ ] `/admin/fases/builder/FINAL` muestra ambos matches (#103 y #104).
- [ ] Form de finalizar partido pide ganador cuando scores son iguales en eliminatoria.
- [ ] Form de finalizar partido NO pide ganador en GROUPS.
- [ ] Vista pública muestra "Pasa X" cuando aplica.

## Rollback Plan

Si algo se rompe en producción:

1. **Rollback de la columna (último recurso):**
   ```sql
   ALTER TABLE matches DROP COLUMN winner_team_id;
   ```
   Pero solo si nadie escribió `winnerTeamId` todavía. Si ya hay datos, mejor revertir el código y dejar la columna.

2. **Rollback del código:**
   ```bash
   git revert <commit-range>
   git push origin main
   ```
   Dokploy redeploya. La columna queda en DB pero sin uso.

3. **Si solo se rompe el frontend:** revertir solo los commits de Tasks 10-14 y deployar; backend sigue funcionando.

## Notas finales

- Mantener el orden estricto de fases A → B → C → D → E. Saltar etapas (ej. desplegar frontend antes que backend) rompe en producción.
- Los commits de cada Task son atómicos para facilitar revert granular.
- Cuando el reviewer subagent o el code-reviewer marque issues durante PR, fix antes de mergear — no acumular debt.

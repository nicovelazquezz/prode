# Admin match predictions audit

Date: 2026-05-13
Status: approved (pending spec review loop + user review of this doc)

## Context

The prode runs a closed beta in production. The admin finalised the
first match end-to-end (smoke test) and immediately hit a gap: there
is no UI to see *who predicted what and how many points each one
earned* for a given match. The existing `/admin/partidos/[id]` page
shows the match itself (kickoff, teams, status, score) but never the
predictions.

The fix is a new section embedded in that same page plus the backend
endpoint that feeds it. Everything else (filters, sort, search,
visibility policy) is driven by product decisions captured below.

## Decisions

Made explicitly during brainstorming (not negotiated again here):

- **Location**: a new `<section>` inside `/admin/partidos/[id]`, right
  below "Editar". Not a separate page, not a drawer. One contextual URL
  per match.
- **Visibility**: predictions are visible to the admin **at all times**,
  including before kickoff. The admin already has DB access; gating UI
  visibility is a false security boundary in a closed-beta where the
  admin is the operator.
- **Filters/sort/search**: full set — sort by `points_desc` (default),
  filter by `outcomeType`, search case-insensitive against name + DNI.
- **Polling**: 30 s (same cadence as the public leaderboard) so the
  admin can watch users load predictions in real time before kickoff.

## 1. Backend: `GET /admin/matches/:id/predictions`

New endpoint on `AdminMatchesController`. Auth: `RolesGuard` +
`@Roles('ADMIN')` (same pattern as siblings).

### Query params (all optional)

| Param      | Type / range                                                                                   | Default        |
| ---------- | ---------------------------------------------------------------------------------------------- | -------------- |
| `page`     | int ≥ 1                                                                                        | `1`            |
| `pageSize` | int 1–200                                                                                      | `50`           |
| `outcome`  | `EXACT \| WINNER_AND_DIFF \| DRAW_DIFFERENT \| WINNER_ONLY \| MISS \| PENDING`                  | unset (no filter) |
| `search`   | string, ≤ 100 chars                                                                            | unset          |
| `sort`     | `points_desc \| points_asc \| name_asc \| name_desc \| prediction`                             | `points_desc`  |

`outcome=PENDING` is the sentinel for `outcomeType IS NULL` (not yet
evaluated). Anything else maps 1:1 to the enum.

`search` matches `firstName` ILIKE, `lastName` ILIKE, and `dni`
substring — same rule as `GET /admin/users` so the admin doesn't need
to learn a second convention.

### Response shape

```ts
{
  match: {
    id: string;
    matchNumber: number;
    phase: Phase;
    status: MatchStatus;
    scoreHome: number | null;
    scoreAway: number | null;
    finishedAt: string | null;
    homeTeamLabel: string;
    awayTeamLabel: string;
  };
  stats: {
    totalPredictions: number;
    evaluatedCount: number;
    exactCount: number;
    winnerAndDiffCount: number;
    drawDifferentCount: number;
    winnerOnlyCount: number;
    missCount: number;
    pointsDistributed: number;
  };
  data: Array<{
    predictionId: string;
    entryId: string;
    userId: string;
    userDni: string;
    userFirstName: string;
    userLastName: string;
    entryAlias: string | null;
    scoreHome: number;
    scoreAway: number;
    outcomeType: OutcomeType | null;
    basePoints: number;
    multiplier: number;
    pointsEarned: number;
    evaluatedAt: string | null;
    updatedAt: string;
  }>;
  page: number;
  pageSize: number;
  total: number;
}
```

### Implementation notes

- One Prisma query for `data`: `prediction.findMany({ where: { matchId, ...filters }, include: { entry: { include: { user: true } } }, skip, take, orderBy })`.
- One `prediction.count({ where: { matchId, ...filters } })` for `total`.
- One `prediction.groupBy({ by: ['outcomeType'], where: { matchId }, _count: true, _sum: { pointsEarned: true } })` for the `stats` block. The stats are computed **over the whole match**, not the filtered subset — they describe the match, the filtered data describes the current view.
- Sort tie-break: `outcomeType` ASC by enum order, then `lastName` ASC.
- 404 if the match doesn't exist (Prisma `findUnique` returns null).
- The index on `predictions(matchId)` already exists from
  `20260504200315_init`; no schema changes.

### Backend tests (`admin-matches-predictions.controller.integration.spec.ts`)

Seed: one match + 5 users with one entry each + 5 predictions with
mixed outcomes (`EXACT`, `WINNER_AND_DIFF`, `WINNER_ONLY`, `MISS`,
`PENDING` aka unevaluated).

- ✅ GET without filters: returns all 5 rows, `stats` reflects each
  bucket, `total = 5`.
- ✅ `?outcome=EXACT`: only the EXACT row.
- ✅ `?outcome=PENDING`: only the unevaluated row.
- ✅ `?search=<lastName>`: matches case-insensitive.
- ✅ `?search=391`: matches DNI substring.
- ✅ `?sort=points_asc`: rows reversed.
- ✅ `?page=2&pageSize=2`: returns rows 3-4 with correct `total`.
- ✅ Match with 0 predictions: `data=[]`, `stats` all zeros.
- ✅ Multi-entry user with two predictions for the same match: two
  rows differentiated by `entryId` and `entryAlias`.
- ✅ `stats.pointsDistributed` matches `SUM(pointsEarned)` regardless
  of which filters are applied to `data`.
- ❌ 404 on unknown matchId.
- ❌ 403 on non-admin user.

## 2. Frontend: section in `/admin/partidos/[id]`

A new `<section>` rendered right after "Editar" in
`frontend/app/(admin)/admin/partidos/[id]/page.tsx`. No new route.

### Layout

**Header**: title "Predicciones" + one-line summary
`{stats.totalPredictions} pronósticos · {stats.evaluatedCount} evaluados · {stats.pointsDistributed} pts repartidos`.

**Stats chips** (clickable, toggles the `outcome` filter):

| Chip                             | Color  |
| -------------------------------- | ------ |
| 🟢 Exactos                       | green  |
| 🟡 Ganador + diff                | yellow |
| 🟡 Empate (otro marcador)        | yellow |
| 🟠 Solo ganador                  | orange |
| 🔴 Errados                       | red    |
| ⚪ Sin evaluar (only if > 0)     | gray   |

Clicking a chip sets `outcome=<value>` in the URL search params and
refetches. Clicking the same chip again clears the filter.

**Toolbar** above the table:
- `<input type="search" />` for name/DNI (debounce 300ms, min 2 chars).
  Reuses the same UX shape as `<UserCombobox />`.
- `<select>` for sort (5 options).
- `<select>` for outcome (redundant with chips but always discoverable).

URL state: filter, search, and sort persist in the query string so the
admin can refresh / share / back-forward without losing the view.

### Table

Uses the existing `AdminDataTable` component.

| Column        | Content                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------- |
| #             | Ordinal position. Shown only when `sort=points_desc`.                                    |
| Usuario       | `firstName lastName` + small `DNI <dni>` below. `entryAlias` chip if multi-prode.        |
| Pronóstico    | `scoreHome - scoreAway` in mono, large. Tiny ✓/✗ next to it when match `FINISHED`.       |
| Outcome       | Colored badge: EXACT green, W&D / DRAW_DIFFERENT yellow, WINNER_ONLY orange, MISS red, PENDING gray. |
| Puntos        | `pointsEarned` mono+bold. Tooltip on hover: `{basePoints} × {multiplier}`.               |
| Cargada       | `updatedAt` short format ("12 jun, 14:30"). Useful to spot last-minute loads.            |

**Empty state**: "Aún nadie cargó predicción para este partido."

**Banners conditional on `match.status`**:
- `CANCELLED`: "Este partido fue cancelado. Las predicciones no suman puntos."
- `POSTPONED`: "Este partido fue postergado. Cuando se finalice se evaluarán."

**Pagination**: standard, only when `total > pageSize`. Uses the same
`<Pagination />` pattern as the leaderboard pages.

### Polling

- `useQuery` with `refetchInterval: 30_000`,
  `refetchIntervalInBackground: false`,
  `refetchOnWindowFocus: false`.
- Refresh button next to the section header for manual force-refetch.

### Frontend tests

Component-level (Vitest + MSW):

- ✅ Renders empty state when `totalPredictions === 0`.
- ✅ Click on a stats chip changes the URL `outcome` query param and
  triggers refetch.
- ✅ Click on the same chip a second time clears the filter.
- ✅ Search input debounces 300 ms before refetching.
- ✅ Sort dropdown updates the `sort` query param.
- ✅ Banner shown when `match.status === 'CANCELLED'`.

### Client API

`frontend/lib/api/admin.ts` (new export):

```ts
export interface MatchPredictionsQuery {
  page?: number;
  pageSize?: number;
  outcome?: OutcomeType | "PENDING";
  search?: string;
  sort?: "points_desc" | "points_asc" | "name_asc" | "name_desc" | "prediction";
}

export async function getMatchPredictions(
  matchId: string,
  query?: MatchPredictionsQuery,
): Promise<MatchPredictionsResponse> {
  return api
    .get(`admin/matches/${matchId}/predictions`, { searchParams: cleanParams(query) })
    .json<MatchPredictionsResponse>();
}
```

## 3. Edge cases

- **Unevaluated predictions** (`outcomeType=null`): show gray
  "Sin evaluar" badge; Puntos column renders `—` instead of `0`. They
  count toward `totalPredictions - evaluatedCount`, not any outcome
  bucket.
- **Match `CANCELLED`**: predictions stay in DB with `pointsEarned=0`,
  `outcomeType=null`. The section still renders so the admin can see
  who had loaded before the cancellation; the banner makes the policy
  obvious.
- **Match `POSTPONED`**: same treatment, banner adjusted.
- **Recalculate after a result correction**: the endpoint reads
  current DB state, so the next poll reflects the new outcomes/points
  without any extra logic.
- **Multi-entry user**: a user with two entries that both predicted
  this match appears as two rows distinguished by `entryAlias` (or
  `entryId` when no alias).
- **Tied points**: tie-break by `outcomeType` (EXACT first), then
  `lastName ASC`. Deterministic.

## 4. Performance budget

- ~500 users × 1 entry average = 500 predictions per match worst case.
- `prediction.findMany` with `pageSize=50` + indexed
  `WHERE matchId = ?` is sub-50ms easily.
- No caching layer for v1. If a future hot path emerges, wrap with a
  30 s Redis cache aligned with the polling interval.

## 5. Out of scope

- Editing other users' predictions from the admin (rare correction
  path — admin uses DB if needed).
- CSV / Excel export.
- Per-prediction audit history (who changed what when — the existing
  audit log captures match-level changes already).
- Comparing predictions across multiple matches.

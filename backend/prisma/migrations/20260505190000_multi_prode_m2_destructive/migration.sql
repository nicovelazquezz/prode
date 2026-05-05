-- Multi-prode M2 destructive migration.
--
-- Pre-requisites (must run BEFORE this migration in dev/staging/prod):
--   1. Apply 20260505184918_multi_prode_m1_additive (entries table + nullable entryId).
--   2. Run scripts/multi-prode-backfill.ts (populates entryId).
--   3. Run scripts/multi-prode-backup-orphans.sql (saves entryId IS NULL rows).
--   4. Run scripts/multi-prode-delete-orphans.sql (purges them; asserts NULL=0).
--
-- This migration:
--   * Drops the leaderboard_global materialized view (depends on userId cols).
--   * Drops user-scoped FKs/indexes/constraints from the 4 affected tables.
--   * Drops the legacy userId columns and makes entryId NOT NULL.
--   * Recreates leaderboard_global keyed by entry_id (per spec §2.5).
--
-- The orphan backup tables (predictions_orphaned_backup_2026_05_XX etc.) are
-- INTENTIONALLY preserved — they are out-of-band artefacts retained for 30
-- days for audit, NOT managed by Prisma.

-- DROP MV before we rip userId out of predictions/special_predictions.
DROP MATERIALIZED VIEW IF EXISTS leaderboard_global;

-- DropForeignKey
ALTER TABLE "league_memberships" DROP CONSTRAINT "league_memberships_userId_fkey";

-- DropForeignKey
ALTER TABLE "phase_winners" DROP CONSTRAINT "phase_winners_entryId_fkey";

-- DropForeignKey
ALTER TABLE "phase_winners" DROP CONSTRAINT "phase_winners_userId_fkey";

-- DropForeignKey
ALTER TABLE "predictions" DROP CONSTRAINT "predictions_userId_fkey";

-- DropForeignKey
ALTER TABLE "special_predictions" DROP CONSTRAINT "special_predictions_userId_fkey";

-- DropIndex
DROP INDEX "league_memberships_leagueId_userId_key";

-- DropIndex
DROP INDEX "league_memberships_userId_idx";

-- DropIndex
DROP INDEX "phase_winners_userId_idx";

-- DropIndex
DROP INDEX "predictions_entryId_idx";

-- DropIndex
DROP INDEX "predictions_userId_evaluatedAt_idx";

-- DropIndex
DROP INDEX "predictions_userId_matchId_key";

-- DropIndex
DROP INDEX "special_predictions_userId_key";

-- AlterTable
ALTER TABLE "league_memberships" DROP COLUMN "userId",
ALTER COLUMN "entryId" SET NOT NULL;

-- AlterTable
ALTER TABLE "phase_winners" DROP COLUMN "userId",
ALTER COLUMN "entryId" SET NOT NULL;

-- AlterTable
ALTER TABLE "predictions" DROP COLUMN "userId",
ALTER COLUMN "entryId" SET NOT NULL;

-- AlterTable
ALTER TABLE "special_predictions" DROP COLUMN "userId",
ALTER COLUMN "entryId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "league_memberships_leagueId_entryId_key" ON "league_memberships"("leagueId", "entryId");

-- CreateIndex
CREATE INDEX "predictions_entryId_evaluatedAt_idx" ON "predictions"("entryId", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "predictions_entryId_matchId_key" ON "predictions"("entryId", "matchId");

-- AddForeignKey
ALTER TABLE "phase_winners" ADD CONSTRAINT "phase_winners_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Recreate leaderboard_global keyed by entry_id. See spec §2.5.
CREATE MATERIALIZED VIEW leaderboard_global AS
SELECT
  e.id AS entry_id,
  e."userId" AS user_id,
  e.position AS entry_position,
  e.alias AS entry_alias,
  u."firstName" AS first_name,
  u."lastName" AS last_name,
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
GROUP BY e.id, e."userId", e.position, e.alias, u."firstName", u."lastName", sp."totalPoints", sp."championTeamId";

CREATE UNIQUE INDEX leaderboard_global_entry_id_idx ON leaderboard_global (entry_id);
CREATE INDEX leaderboard_global_total_points_idx
  ON leaderboard_global (total_points DESC, exact_count DESC, hits_count DESC);
CREATE INDEX leaderboard_global_user_id_idx ON leaderboard_global (user_id);

REFRESH MATERIALIZED VIEW leaderboard_global;

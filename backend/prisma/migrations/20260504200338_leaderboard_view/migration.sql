-- Materialized view: leaderboard_global
-- Refreshed asynchronously via BullMQ job `leaderboard.refresh`
-- (REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global).
--
-- Source columns are quoted-camelCase because the Prisma models do not use
-- @map on individual columns; output columns use snake_case aliases for
-- consumers (raw queries via prisma.$queryRaw).

CREATE MATERIALIZED VIEW leaderboard_global AS
SELECT
  u.id AS user_id,
  u."firstName" AS first_name,
  u."lastName" AS last_name,
  COALESCE(SUM(p."pointsEarned"), 0) +
    COALESCE(sp."totalPoints", 0) AS total_points,
  COUNT(p.id) FILTER (WHERE p."outcomeType" = 'EXACT') AS exact_count,
  COUNT(p.id) FILTER (WHERE p."outcomeType" IN ('EXACT','WINNER_AND_DIFF','WINNER_ONLY','DRAW_DIFFERENT')) AS hits_count,
  sp."championTeamId" IS NOT NULL AS has_champion_pick
FROM users u
LEFT JOIN predictions p ON p."userId" = u.id
LEFT JOIN special_predictions sp ON sp."userId" = u.id
WHERE u.status = 'ACTIVE'
GROUP BY u.id, u."firstName", u."lastName", sp."totalPoints", sp."championTeamId";

CREATE UNIQUE INDEX leaderboard_global_user_id_idx ON leaderboard_global (user_id);
CREATE INDEX leaderboard_global_total_points_idx
  ON leaderboard_global (total_points DESC, exact_count DESC, hits_count DESC);

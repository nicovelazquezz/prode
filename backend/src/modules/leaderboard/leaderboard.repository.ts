import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { Phase } from '../../../generated/prisma/enums.js';

/**
 * One row of the public leaderboard. The shape mirrors the
 * `leaderboard_global` materialized view (snake_case aliases) so consumers
 * can blindly forward the JSON without an extra mapping layer.
 *
 * `total_points`, `exact_count`, and `hits_count` come back from Postgres
 * as `bigint` when sourced from `SUM`/`COUNT`, so we keep this interface
 * loose (`number | bigint`) and let the repository normalise to plain
 * numbers before returning. That way the controller/service tier never
 * has to think about JS bigint serialisation gotchas.
 */
export interface LeaderboardRow {
  user_id: string;
  first_name: string;
  last_name: string;
  total_points: number;
  exact_count: number;
  hits_count: number;
  has_champion_pick: boolean;
}

/**
 * Row returned by `getGlobalAroundUser`. Same as `LeaderboardRow` plus the
 * computed `rank` window function output. The "around" endpoint is the
 * only place rank is materialised — for the paged listings, the caller
 * already knows the rank from `(page-1) * pageSize + index + 1`.
 */
export interface LeaderboardRowWithRank extends LeaderboardRow {
  rank: number;
}

interface RawAggregateRow {
  user_id: string;
  first_name: string;
  last_name: string;
  total_points: number | bigint | string;
  exact_count: number | bigint | string;
  hits_count: number | bigint | string;
  has_champion_pick: boolean;
}

interface RawRankedRow extends RawAggregateRow {
  rank: number | bigint | string;
}

/**
 * Coerces a Postgres-returned numeric (which arrives as `bigint` for
 * SUM/COUNT/ROW_NUMBER and as `number` for boolean-typed columns) into a
 * plain JS `number`. We accept the precision loss because the leaderboard
 * range — points, counts, ranks — comfortably fits in 32-bit ints for the
 * <200-user scale of this app. JSON.stringify on bigints throws otherwise.
 */
function asNumber(v: number | bigint | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return Number(v);
}

function normaliseRow(r: RawAggregateRow): LeaderboardRow {
  return {
    user_id: r.user_id,
    first_name: r.first_name,
    last_name: r.last_name,
    total_points: asNumber(r.total_points),
    exact_count: asNumber(r.exact_count),
    hits_count: asNumber(r.hits_count),
    has_champion_pick: Boolean(r.has_champion_pick),
  };
}

/**
 * Raw-SQL access layer for the leaderboard endpoints.
 *
 * Why raw SQL: the global ladder reads from a materialized view
 * (`leaderboard_global`) Prisma doesn't model, the per-phase ladder
 * needs `FILTER (WHERE …)` aggregates Prisma's groupBy can't express,
 * and the "around me" endpoint needs `ROW_NUMBER()` for stable ranks
 * across ties. A repo wrapper keeps `$queryRaw` calls in one auditable
 * place and lets the service layer stay small.
 *
 * Column names: Prisma generated camelCase columns with quoting
 * (`"firstName"`, `"pointsEarned"`, `"userId"`, etc.). The MV exposes
 * snake_case aliases; the on-the-fly aggregations have to quote each
 * camelCase identifier explicitly.
 */
@Injectable()
export class LeaderboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Paged read of the global leaderboard. Order by points DESC, then
   * exact_count DESC, then hits_count DESC — same tie-breaking sequence
   * as the index `leaderboard_global_total_points_idx`, so the planner
   * can serve this with an index scan even at full-tournament size.
   */
  async getGlobal(
    page: number,
    pageSize: number,
  ): Promise<{ rows: LeaderboardRow[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<RawAggregateRow[]>`
      SELECT user_id, first_name, last_name, total_points,
             exact_count, hits_count, has_champion_pick
      FROM leaderboard_global
      ORDER BY total_points DESC, exact_count DESC, hits_count DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const totalRows = await this.prisma.$queryRaw<
      Array<{ count: number | bigint | string }>
    >`SELECT COUNT(*)::bigint AS count FROM leaderboard_global`;
    return {
      rows: rows.map(normaliseRow),
      total: asNumber(totalRows[0]?.count ?? 0),
    };
  }

  /**
   * Returns N rows above + the user's own row + N rows below, ordered by
   * rank ascending. Falls back to an empty array when the user isn't in
   * the MV (e.g. INACTIVE/BANNED, or never had a prediction).
   *
   * Implementation: ROW_NUMBER() materialises a stable rank per user,
   * then a second pass clips the window around the caller's rank. The CTE
   * shape avoids a second sort — the outer SELECT pulls a contiguous slice
   * by rank, which is already monotonic.
   */
  async getGlobalAroundUser(
    userId: string,
    n: number,
  ): Promise<LeaderboardRowWithRank[]> {
    const rows = await this.prisma.$queryRaw<RawRankedRow[]>`
      WITH ranked AS (
        SELECT user_id, first_name, last_name, total_points,
               exact_count, hits_count, has_champion_pick,
               ROW_NUMBER() OVER (
                 ORDER BY total_points DESC, exact_count DESC, hits_count DESC
               ) AS rank
        FROM leaderboard_global
      ),
      me AS (SELECT rank FROM ranked WHERE user_id = ${userId})
      SELECT r.user_id, r.first_name, r.last_name, r.total_points,
             r.exact_count, r.hits_count, r.has_champion_pick, r.rank
      FROM ranked r, me
      WHERE r.rank BETWEEN me.rank - ${n} AND me.rank + ${n}
      ORDER BY r.rank
    `;
    return rows.map((r) => ({
      ...normaliseRow(r),
      rank: asNumber(r.rank),
    }));
  }

  /**
   * Paged per-phase leaderboard. The MV doesn't carry phase-level points
   * (it would explode the row count), so this aggregates on-the-fly. The
   * LEFT JOIN on matches uses `m.phase = ${phase}` instead of a WHERE so
   * a user who only played other phases still appears with 0 points.
   *
   * Why the explicit `m.id IS NOT NULL` guard inside each FILTER and
   * aggregate: with a LEFT JOIN ... ON p."matchId" = m.id AND m.phase = X,
   * a prediction whose match is NOT in this phase still has a non-null
   * row for `p` (it was joined off `users` first), but `m.*` is NULL. The
   * guard makes the aggregate skip those rows so totals only reflect the
   * target phase. Without it the aggregate would include every prediction
   * the user ever made.
   *
   * Postgres "predictions" columns are camelCase + quoted (Prisma default
   * naming). `OutcomeType` enum literals must stay capitalised.
   */
  async getByPhase(
    phase: Phase,
    page: number,
    pageSize: number,
  ): Promise<{ rows: LeaderboardRow[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<RawAggregateRow[]>`
      SELECT
        u.id AS user_id,
        u."firstName" AS first_name,
        u."lastName" AS last_name,
        COALESCE(SUM(p."pointsEarned") FILTER (WHERE m.id IS NOT NULL), 0) AS total_points,
        COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND p."outcomeType" = 'EXACT') AS exact_count,
        COUNT(p.id) FILTER (
          WHERE m.id IS NOT NULL
            AND p."outcomeType" IN ('EXACT','WINNER_AND_DIFF','WINNER_ONLY','DRAW_DIFFERENT')
        ) AS hits_count,
        FALSE AS has_champion_pick
      FROM users u
      LEFT JOIN predictions p ON p."userId" = u.id
      LEFT JOIN matches m ON p."matchId" = m.id AND m.phase = ${phase}::"Phase"
      WHERE u.status = 'ACTIVE'
      GROUP BY u.id, u."firstName", u."lastName"
      ORDER BY total_points DESC, exact_count DESC, hits_count DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    // Total active-user count — same denominator regardless of phase
    // (every active user is a row in the per-phase board, scoring 0
    // when they have no predictions in that phase).
    const totalRows = await this.prisma.$queryRaw<
      Array<{ count: number | bigint | string }>
    >`SELECT COUNT(*)::bigint AS count FROM users WHERE status = 'ACTIVE'`;
    return {
      rows: rows.map(normaliseRow),
      total: asNumber(totalRows[0]?.count ?? 0),
    };
  }

  /**
   * League leaderboard — global MV filtered to members of `leagueId`. The
   * MV already carries the aggregate; we just narrow it via a join on
   * `league_memberships`. Inner join means a member who isn't yet in the
   * MV (e.g. INACTIVE) is silently excluded — matches the MV's own
   * `WHERE u.status = 'ACTIVE'` predicate.
   */
  async getByLeague(
    leagueId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: LeaderboardRow[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<RawAggregateRow[]>`
      SELECT lg.user_id, lg.first_name, lg.last_name, lg.total_points,
             lg.exact_count, lg.hits_count, lg.has_champion_pick
      FROM leaderboard_global lg
      INNER JOIN league_memberships lm ON lm."userId" = lg.user_id
      WHERE lm."leagueId" = ${leagueId}
      ORDER BY lg.total_points DESC, lg.exact_count DESC, lg.hits_count DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const totalRows = await this.prisma.$queryRaw<
      Array<{ count: number | bigint | string }>
    >`
      SELECT COUNT(*)::bigint AS count
      FROM leaderboard_global lg
      INNER JOIN league_memberships lm ON lm."userId" = lg.user_id
      WHERE lm."leagueId" = ${leagueId}
    `;
    return {
      rows: rows.map(normaliseRow),
      total: asNumber(totalRows[0]?.count ?? 0),
    };
  }
}

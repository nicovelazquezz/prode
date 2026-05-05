import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { Phase } from '../../../generated/prisma/enums.js';

/**
 * One row of the public leaderboard. The shape mirrors the
 * `leaderboard_global` materialized view (snake_case aliases) so consumers
 * can blindly forward the JSON without an extra mapping layer.
 *
 * Multi-prode: one row per ENTRY (not user). `user_id` is the human
 * owner; `entry_id`/`entry_position`/`entry_alias` describe the entry.
 *
 * `total_points`, `exact_count`, and `hits_count` come back from Postgres
 * as `bigint` when sourced from `SUM`/`COUNT`, so we keep this interface
 * loose (`number | bigint`) and let the repository normalise to plain
 * numbers before returning. That way the controller/service tier never
 * has to think about JS bigint serialisation gotchas.
 */
export interface LeaderboardRow {
  entry_id: string;
  user_id: string;
  entry_position: number;
  entry_alias: string | null;
  first_name: string;
  last_name: string;
  total_points: number;
  exact_count: number;
  hits_count: number;
  has_champion_pick: boolean;
}

/**
 * Row returned by `getGlobalAroundEntry`. Same as `LeaderboardRow` plus
 * the computed `rank` window function output. The "around" endpoint is
 * the only place rank is materialised — for the paged listings, the
 * caller already knows the rank from `(page-1) * pageSize + index + 1`.
 */
export interface LeaderboardRowWithRank extends LeaderboardRow {
  rank: number;
}

interface RawAggregateRow {
  entry_id: string;
  user_id: string;
  entry_position: number | bigint | string;
  entry_alias: string | null;
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

function asNumber(v: number | bigint | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return Number(v);
}

function normaliseRow(r: RawAggregateRow): LeaderboardRow {
  return {
    entry_id: r.entry_id,
    user_id: r.user_id,
    entry_position: asNumber(r.entry_position),
    entry_alias: r.entry_alias,
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
 * Multi-prode: the MV is keyed by entry_id (one row per Entry). All
 * rankings here are by entry; the user_id column is exposed so the
 * frontend can render the human owner's name.
 */
@Injectable()
export class LeaderboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Paged read of the global leaderboard. Order by points DESC, then
   * exact_count DESC, then hits_count DESC.
   */
  async getGlobal(
    page: number,
    pageSize: number,
  ): Promise<{ rows: LeaderboardRow[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<RawAggregateRow[]>`
      SELECT entry_id, user_id, entry_position, entry_alias,
             first_name, last_name, total_points,
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
   * Returns N rows above + the entry's own row + N rows below, ordered
   * by rank ascending. Falls back to an empty array when the entry isn't
   * in the MV (e.g. INACTIVE/ANNULLED, or never had a prediction).
   *
   * Implementation: ROW_NUMBER() materialises a stable rank per entry,
   * then a second pass clips the window around the caller's rank.
   */
  async getGlobalAroundEntry(
    entryId: string,
    n: number,
  ): Promise<LeaderboardRowWithRank[]> {
    const rows = await this.prisma.$queryRaw<RawRankedRow[]>`
      WITH ranked AS (
        SELECT entry_id, user_id, entry_position, entry_alias,
               first_name, last_name, total_points,
               exact_count, hits_count, has_champion_pick,
               ROW_NUMBER() OVER (
                 ORDER BY total_points DESC, exact_count DESC, hits_count DESC
               ) AS rank
        FROM leaderboard_global
      ),
      me AS (SELECT rank FROM ranked WHERE entry_id = ${entryId})
      SELECT r.entry_id, r.user_id, r.entry_position, r.entry_alias,
             r.first_name, r.last_name, r.total_points,
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
   * Returns just the rank for a given entry, or null if it isn't in the
   * MV. Cheaper than `getGlobalAroundEntry(_, 0)` when the caller only
   * needs the integer.
   */
  async getEntryRank(entryId: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ rank: number | bigint | string }>
    >`
      WITH ranked AS (
        SELECT entry_id,
               ROW_NUMBER() OVER (
                 ORDER BY total_points DESC, exact_count DESC, hits_count DESC
               ) AS rank
        FROM leaderboard_global
      )
      SELECT rank FROM ranked WHERE entry_id = ${entryId}
    `;
    if (rows.length === 0) return null;
    return asNumber(rows[0].rank);
  }

  /**
   * Paged per-phase leaderboard, keyed by entry. Aggregates predictions
   * on-the-fly by phase (no MV per phase). One row per ACTIVE entry of
   * an ACTIVE user; entries with no predictions in that phase still
   * appear with 0 points.
   */
  async getByPhase(
    phase: Phase,
    page: number,
    pageSize: number,
  ): Promise<{ rows: LeaderboardRow[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<RawAggregateRow[]>`
      SELECT
        e.id AS entry_id,
        e."userId" AS user_id,
        e.position AS entry_position,
        e.alias AS entry_alias,
        u."firstName" AS first_name,
        u."lastName" AS last_name,
        COALESCE(SUM(p."pointsEarned") FILTER (WHERE m.id IS NOT NULL), 0) AS total_points,
        COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND p."outcomeType" = 'EXACT') AS exact_count,
        COUNT(p.id) FILTER (
          WHERE m.id IS NOT NULL
            AND p."outcomeType" IN ('EXACT','WINNER_AND_DIFF','WINNER_ONLY','DRAW_DIFFERENT')
        ) AS hits_count,
        FALSE AS has_champion_pick
      FROM entries e
      INNER JOIN users u ON u.id = e."userId"
      LEFT JOIN predictions p ON p."entryId" = e.id
      LEFT JOIN matches m ON p."matchId" = m.id AND m.phase = ${phase}::"Phase"
      WHERE u.status = 'ACTIVE' AND e.status = 'ACTIVE'
      GROUP BY e.id, e."userId", e.position, e.alias, u."firstName", u."lastName"
      ORDER BY total_points DESC, exact_count DESC, hits_count DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const totalRows = await this.prisma.$queryRaw<
      Array<{ count: number | bigint | string }>
    >`
      SELECT COUNT(*)::bigint AS count
      FROM entries e
      INNER JOIN users u ON u.id = e."userId"
      WHERE u.status = 'ACTIVE' AND e.status = 'ACTIVE'
    `;
    return {
      rows: rows.map(normaliseRow),
      total: asNumber(totalRows[0]?.count ?? 0),
    };
  }

  /**
   * League leaderboard — global MV filtered to entries that are members
   * of `leagueId`. The MV already carries the aggregate; we just narrow
   * via a join on `league_memberships` (whose entryId now points to
   * Entry, not User).
   */
  async getByLeague(
    leagueId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: LeaderboardRow[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<RawAggregateRow[]>`
      SELECT lg.entry_id, lg.user_id, lg.entry_position, lg.entry_alias,
             lg.first_name, lg.last_name, lg.total_points,
             lg.exact_count, lg.hits_count, lg.has_champion_pick
      FROM leaderboard_global lg
      INNER JOIN league_memberships lm ON lm."entryId" = lg.entry_id
      WHERE lm."leagueId" = ${leagueId}
      ORDER BY lg.total_points DESC, lg.exact_count DESC, lg.hits_count DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const totalRows = await this.prisma.$queryRaw<
      Array<{ count: number | bigint | string }>
    >`
      SELECT COUNT(*)::bigint AS count
      FROM leaderboard_global lg
      INNER JOIN league_memberships lm ON lm."entryId" = lg.entry_id
      WHERE lm."leagueId" = ${leagueId}
    `;
    return {
      rows: rows.map(normaliseRow),
      total: asNumber(totalRows[0]?.count ?? 0),
    };
  }
}

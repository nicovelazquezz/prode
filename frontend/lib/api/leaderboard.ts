import { api } from "./client";
import type {
  LeaderboardEntry,
  MeAroundResult,
  PaginatedLeaderboard,
  Phase,
} from "./types";

/**
 * Wire shape returned by every backend leaderboard endpoint
 * (`/leaderboard/global`, `/leaderboard/phase/:phase`, etc.). See
 * backend/src/modules/leaderboard/leaderboard.service.ts.
 */
interface LeaderboardWireRow {
  user_id: string;
  first_name: string;
  last_name: string;
  total_points: number;
  exact_count: number;
  hits_count: number;
  has_champion_pick: boolean;
}

interface LeaderboardWireResponse {
  rows: LeaderboardWireRow[];
  total: number;
  page?: number;
  pageSize?: number;
}

/**
 * Adapts the backend's snake_case `rows` payload to the camelCased
 * `entries` shape consumed by our UI components, and synthesizes the
 * 1-based `position` from the row index. Keeps the rest of the
 * frontend ignorant of the wire format.
 */
function adapt(res: LeaderboardWireResponse): PaginatedLeaderboard {
  const entries: LeaderboardEntry[] = res.rows.map((r, idx) => ({
    position: idx + 1,
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    totalPoints: r.total_points,
  }));
  return {
    entries,
    total: res.total,
    page: res.page ?? 1,
    pageSize: res.pageSize ?? entries.length,
  };
}

export async function getGlobal(query?: {
  page?: number;
  pageSize?: number;
}): Promise<PaginatedLeaderboard> {
  const res = await api
    .get("leaderboard/global", { searchParams: cleanParams(query) })
    .json<LeaderboardWireResponse>();
  return adapt(res);
}

export async function getByPhase(
  phase: Phase,
  query?: { page?: number; pageSize?: number },
): Promise<PaginatedLeaderboard> {
  const res = await api
    .get(`leaderboard/phase/${phase}`, {
      searchParams: cleanParams(query),
    })
    .json<LeaderboardWireResponse>();
  return adapt(res);
}

export async function getMyAround(): Promise<MeAroundResult> {
  // Backend returns `{ rows: [{ user_id, ..., rank }, ...] }`. The
  // current user is the row whose rank matches the page's pagination
  // ordering — but the simpler invariant is the row whose user_id
  // matches the JWT subject. We surface a flat shape with `position`,
  // `totalPoints`, `totalUsers`, and the context rows for the UI.
  const wire = await api
    .get("leaderboard/me/around")
    .json<{
      rows: Array<
        LeaderboardWireRow & { rank: number }
      >;
      meIndex?: number;
    }>();

  const context: LeaderboardEntry[] = wire.rows.map((r) => ({
    position: r.rank,
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    totalPoints: r.total_points,
  }));

  // The "me" row is whichever has the current user's id. We don't
  // have access to it here, so fall back to the middle row (the
  // backend centres the window around the user). If the array has
  // an explicit `meIndex` we use it.
  const meIdx =
    wire.meIndex !== undefined
      ? wire.meIndex
      : Math.min(
          Math.max(0, Math.floor(wire.rows.length / 2)),
          wire.rows.length - 1,
        );
  const meRow = wire.rows[meIdx];

  return {
    position: meRow?.rank ?? 0,
    totalUsers: wire.rows.length,
    totalPoints: meRow?.total_points ?? 0,
    context,
  };
}

export async function getByLeague(
  leagueId: string,
  query?: { page?: number; pageSize?: number },
): Promise<PaginatedLeaderboard> {
  const res = await api
    .get(`leaderboard/league/${leagueId}`, {
      searchParams: cleanParams(query),
    })
    .json<LeaderboardWireResponse>();
  return adapt(res);
}

function cleanParams(
  params?: Record<string, string | number | boolean | undefined>,
): Record<string, string> {
  if (!params) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) result[key] = String(value);
  }
  return result;
}

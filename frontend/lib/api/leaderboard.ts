import { api } from "./client";
import type {
  LeaderboardEntry,
  MeAroundResult,
  PaginatedLeaderboard,
  Phase,
} from "./types";

/**
 * Wire shape returned por todos los endpoints del backend de
 * leaderboard (`/leaderboard/global`, `/leaderboard/phase/:phase`,
 * etc.). Después de multi-prode v1.1, cada row es un Entry — no
 * un User. La MV `leaderboard_global` agrupa por entry_id y agrega
 * los campos `entry_id`, `entry_position`, `entry_alias` además
 * del `user_id` del dueño humano (spec §2.5).
 *
 * Mantenemos los campos legacy también opcionales para no romper
 * cuando el backend está mid-migración (M1 sin destructive M2).
 */
interface LeaderboardWireRow {
  user_id: string;
  first_name: string;
  last_name: string;
  total_points: number;
  exact_count: number;
  hits_count: number;
  has_champion_pick: boolean;
  // Campos multi-prode (post-M2)
  entry_id?: string;
  entry_position?: number;
  entry_alias?: string | null;
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
 * 1-based `position` from the row index.
 *
 * Multi-prode: si el backend manda `entry_id`, lo propagamos; si no,
 * caemos a `user_id` como id (compat dev / pre-M2).
 */
function adapt(res: LeaderboardWireResponse): PaginatedLeaderboard {
  const entries: LeaderboardEntry[] = res.rows.map((r, idx) => ({
    position: idx + 1,
    entryId: r.entry_id ?? r.user_id,
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    alias: r.entry_alias ?? null,
    entryPosition: r.entry_position ?? 1,
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

/**
 * Multi-prode v1.1: el "alrededor de mí" ahora se calcula por
 * entry específica. Backend: `GET /leaderboard/entry/:entryId/around`.
 * El backend valida que el entry pertenezca al user autenticado.
 *
 * Devuelve la posición del entry, total de entries en el ranking
 * y un context window de N rows alrededor (el meIndex marca cuál
 * es el row del entry consultado).
 */
export async function getAroundEntry(
  entryId: string,
): Promise<MeAroundResult> {
  const wire = await api
    .get(`leaderboard/entry/${entryId}/around`)
    .json<{
      rows: Array<LeaderboardWireRow & { rank: number }>;
      meIndex?: number;
    }>();

  const context: LeaderboardEntry[] = wire.rows.map((r) => ({
    position: r.rank,
    entryId: r.entry_id ?? r.user_id,
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    alias: r.entry_alias ?? null,
    entryPosition: r.entry_position ?? 1,
    totalPoints: r.total_points,
  }));

  // El backend nos dice qué row es el "yo"; si no, asumimos el
  // centro de la ventana (defensa: backend siempre debería mandar
  // meIndex después de multi-prode, pero compat con respuestas viejas).
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

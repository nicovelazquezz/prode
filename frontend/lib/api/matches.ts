import { api } from "./client";
import type { Match, Phase } from "./types";

export async function getMatches(query?: {
  phase?: Phase;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<Match[]> {
  return api.get("matches", { searchParams: cleanParams(query) }).json<Match[]>();
}

export async function getUpcomingMatches(query?: {
  limit?: number;
}): Promise<Match[]> {
  return api
    .get("matches/upcoming", { searchParams: cleanParams(query) })
    .json<Match[]>();
}

export async function getMatchesByPhase(phase: Phase): Promise<Match[]> {
  return api.get(`matches/by-phase/${phase}`).json<Match[]>();
}

/**
 * Endpoint admin para detalle (incluye stats internas). El user
 * normalmente solo ve `getMatches`. Path: GET /admin/matches/:id.
 */
export async function getMatchById(id: string): Promise<Match> {
  return api.get(`admin/matches/${id}`).json<Match>();
}

/**
 * Lookup publico de un match por id sin pasar por el endpoint admin.
 * No hay endpoint dedicado en el backend, asi que listamos y filtramos.
 * Cache es responsabilidad del caller (TanStack Query staleTime).
 */
export async function getMatchByIdPublic(id: string): Promise<Match | null> {
  // El endpoint /matches devuelve un response paginado (`Paginated<Match>`)
  // ─ pageSize alto cubre todos los partidos del torneo (~64).
  type ListResponse = { data: Match[] } | Match[];
  const raw = await api
    .get("matches", { searchParams: { pageSize: "200" } })
    .json<ListResponse>();
  const items = Array.isArray(raw) ? raw : raw.data;
  return items.find((m) => m.id === id) ?? null;
}

/**
 * Cuenta de predictions cargadas para un partido (publico, cache 60s).
 */
export async function getMatchPredictionCount(
  matchId: string,
): Promise<{ count: number }> {
  return api
    .get(`predictions/match/${matchId}/count`)
    .json<{ count: number }>();
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

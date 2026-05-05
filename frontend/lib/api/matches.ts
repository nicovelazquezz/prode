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

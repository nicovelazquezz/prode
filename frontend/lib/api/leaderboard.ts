import { api } from "./client";
import type {
  MeAroundResult,
  PaginatedLeaderboard,
  Phase,
} from "./types";

export async function getGlobal(query?: {
  page?: number;
  pageSize?: number;
}): Promise<PaginatedLeaderboard> {
  return api
    .get("leaderboard/global", { searchParams: cleanParams(query) })
    .json<PaginatedLeaderboard>();
}

export async function getByPhase(
  phase: Phase,
  query?: { page?: number; pageSize?: number },
): Promise<PaginatedLeaderboard> {
  return api
    .get(`leaderboard/phase/${phase}`, {
      searchParams: cleanParams(query),
    })
    .json<PaginatedLeaderboard>();
}

export async function getMyAround(): Promise<MeAroundResult> {
  return api.get("leaderboard/me/around").json<MeAroundResult>();
}

export async function getByLeague(
  leagueId: string,
  query?: { page?: number; pageSize?: number },
): Promise<PaginatedLeaderboard> {
  return api
    .get(`leaderboard/league/${leagueId}`, {
      searchParams: cleanParams(query),
    })
    .json<PaginatedLeaderboard>();
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

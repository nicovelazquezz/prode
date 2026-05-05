import { api } from "./client";
import type {
  Paginated,
  Phase,
  Prediction,
  SpecialPrediction,
} from "./types";

export async function upsertMatchPrediction(
  matchId: string,
  dto: { scoreHome: number; scoreAway: number },
): Promise<Prediction> {
  return api
    .post(`predictions/match/${matchId}`, { json: dto })
    .json<Prediction>();
}

export async function getMyPredictions(query?: {
  page?: number;
  pageSize?: number;
  phase?: Phase;
}): Promise<Paginated<Prediction>> {
  return api
    .get("predictions/me", { searchParams: cleanParams(query) })
    .json<Paginated<Prediction>>();
}

export async function getMyPredictionForMatch(
  matchId: string,
): Promise<Prediction | null> {
  // Backend devuelve null si no hay prediction; ky desserializa null OK.
  return api
    .get(`predictions/me/match/${matchId}`)
    .json<Prediction | null>();
}

export async function upsertSpecialPrediction(dto: {
  championTeamId?: string | null;
  runnerUpTeamId?: string | null;
  thirdPlaceTeamId?: string | null;
  topScorerId?: string | null;
  topScorerName?: string | null;
  totalGoals?: number | null;
}): Promise<SpecialPrediction> {
  return api
    .post("predictions/special", { json: dto })
    .json<SpecialPrediction>();
}

export async function getMySpecialPrediction(): Promise<SpecialPrediction | null> {
  return api
    .get("predictions/special/me")
    .json<SpecialPrediction | null>();
}

/**
 * Helper: filtra undefined de un objeto antes de pasarlo a `searchParams`
 * de ky (que rechaza undefined values en algunas versiones).
 */
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

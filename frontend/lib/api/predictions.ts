import { api } from "./client";
import type {
  Paginated,
  Phase,
  Prediction,
  SpecialPrediction,
} from "./types";

/**
 * Multi-prode v1.1 — los paths reales del backend ahora son
 * `/entries/:entryId/predictions/...`. Las funciones `getEntry*` /
 * `upsert*` con firma entry-aware son las que se usan en producción.
 *
 * Los wrappers legacy (`getMyPredictions`, etc., sin entryId) se
 * mantienen temporalmente para que las páginas existentes compilen
 * mientras Phase 9 migra cada consumer al activeEntry. Internamente
 * se eliminan al cerrar Phase 9.
 */

// ── Entry-keyed (real) ──────────────────────────────────────────

export function upsertMatchPrediction(
  entryId: string,
  matchId: string,
  dto: { scoreHome: number; scoreAway: number },
): Promise<Prediction>;
/** @deprecated firma legacy sin entryId — usar la sobrecarga (entryId, matchId, dto). */
export function upsertMatchPrediction(
  matchId: string,
  dto: { scoreHome: number; scoreAway: number },
): Promise<Prediction>;
export function upsertMatchPrediction(
  ...args:
    | [string, string, { scoreHome: number; scoreAway: number }]
    | [string, { scoreHome: number; scoreAway: number }]
): Promise<Prediction> {
  if (args.length === 3) {
    const [entryId, matchId, dto] = args;
    return api
      .post(`entries/${entryId}/predictions/match/${matchId}`, { json: dto })
      .json<Prediction>();
  }
  const [matchId, dto] = args;
  return api
    .post(`predictions/match/${matchId}`, { json: dto })
    .json<Prediction>();
}

export async function getEntryPredictions(
  entryId: string,
  query?: {
    page?: number;
    pageSize?: number;
    phase?: Phase;
  },
): Promise<Paginated<Prediction>> {
  return api
    .get(`entries/${entryId}/predictions`, {
      searchParams: cleanParams(query),
    })
    .json<Paginated<Prediction>>();
}

export async function getEntryPredictionForMatch(
  entryId: string,
  matchId: string,
): Promise<Prediction | null> {
  return api
    .get(`entries/${entryId}/predictions/match/${matchId}`)
    .json<Prediction | null>();
}

export async function upsertEntrySpecialPrediction(
  entryId: string,
  dto: {
    championTeamId?: string | null;
    runnerUpTeamId?: string | null;
    thirdPlaceTeamId?: string | null;
    topScorerId?: string | null;
    topScorerName?: string | null;
    totalGoals?: number | null;
  },
): Promise<SpecialPrediction> {
  return api
    .post(`entries/${entryId}/special`, { json: dto })
    .json<SpecialPrediction>();
}

export async function getEntrySpecialPrediction(
  entryId: string,
): Promise<SpecialPrediction | null> {
  return api
    .get(`entries/${entryId}/special`)
    .json<SpecialPrediction | null>();
}

// ── Legacy wrappers (deprecated, removidos al cerrar Phase 9) ───

/** @deprecated usar `getEntryPredictions(entryId, query)` */
export async function getMyPredictions(query?: {
  page?: number;
  pageSize?: number;
  phase?: Phase;
}): Promise<Paginated<Prediction>> {
  return api
    .get("predictions/me", { searchParams: cleanParams(query) })
    .json<Paginated<Prediction>>();
}

/** @deprecated usar `getEntryPredictionForMatch(entryId, matchId)` */
export async function getMyPredictionForMatch(
  matchId: string,
): Promise<Prediction | null> {
  return api
    .get(`predictions/me/match/${matchId}`)
    .json<Prediction | null>();
}

/** @deprecated usar `upsertEntrySpecialPrediction(entryId, dto)` */
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

/** @deprecated usar `getEntrySpecialPrediction(entryId)` */
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

import type { Phase } from "./types";

/**
 * Registry centralizado de query keys (TanStack Query). Conventions:
 *  - Cada recurso es una funcion que devuelve un array `as const` para
 *    que TS infiera tuplas literales (no string[]).
 *  - El primer elemento del array es siempre el dominio del recurso
 *    (matches, predictions, etc.). Esto permite invalidar todo el
 *    dominio con `queryClient.invalidateQueries({ queryKey: ['predictions'] })`.
 *  - Filtros pasan como ultimo elemento (objeto plano).
 *
 * Usar este registry en TODAS las queries y mutations — evita typos
 * y facilita find-references.
 */
export const queryKeys = {
  auth: {
    me: () => ["auth", "me"] as const,
  },
  stats: {
    public: () => ["stats", "public"] as const,
  },
  matches: {
    all: () => ["matches"] as const,
    list: (filters?: Record<string, unknown>) =>
      ["matches", "list", filters ?? {}] as const,
    upcoming: () => ["matches", "upcoming"] as const,
    byPhase: (phase: Phase) => ["matches", "phase", phase] as const,
    detail: (id: string) => ["matches", id] as const,
    predictionCount: (matchId: string) =>
      ["matches", matchId, "predictionCount"] as const,
  },
  players: {
    all: () => ["players"] as const,
    byTeam: (teamId: string) => ["players", "team", teamId] as const,
  },
  /**
   * Multi-prode (v1.1+): predicciones y special prediction se asocian
   * al `entryId`, no al `userId`. Cada entry del user tiene su propio
   * cache. Cambiar el activeEntry invalida `entries.*` (ver
   * `ActiveEntryProvider`).
   *
   * Las keys legacy (`me`, `forMatch`, `special`) quedan deprecated y
   * se eliminan cuando Phase 9 termina la migración de páginas.
   */
  predictions: {
    all: () => ["predictions"] as const,
    /** @deprecated usar `queryKeys.entries.predictions(entryId, filters)` */
    me: (filters?: Record<string, unknown>) =>
      ["predictions", "me", filters ?? {}] as const,
    /** @deprecated usar `queryKeys.entries.predictionForMatch(entryId, matchId)` */
    forMatch: (matchId: string) =>
      ["predictions", "me", "match", matchId] as const,
    /** @deprecated usar `queryKeys.entries.special(entryId)` */
    special: () => ["predictions", "special", "me"] as const,
  },
  entries: {
    all: () => ["entries"] as const,
    me: () => ["entries", "me"] as const,
    detail: (id: string) => ["entries", id] as const,
    predictions: (entryId: string, filters?: Record<string, unknown>) =>
      ["entries", entryId, "predictions", filters ?? {}] as const,
    predictionForMatch: (entryId: string, matchId: string) =>
      ["entries", entryId, "predictions", "match", matchId] as const,
    special: (entryId: string) =>
      ["entries", entryId, "special"] as const,
  },
  leaderboard: {
    all: () => ["leaderboard"] as const,
    global: (page: number) => ["leaderboard", "global", page] as const,
    phase: (phase: Phase, page: number) =>
      ["leaderboard", "phase", phase, page] as const,
    /**
     * Reemplaza el viejo `leaderboard.around()` (user-keyed). Ahora el
     * "alrededor de mí" se calcula por entry específica — un user con
     * 2 entries ve dos contextos distintos según cuál esté activa.
     */
    aroundEntry: (entryId: string) =>
      ["leaderboard", "entry", entryId, "around"] as const,
    /** @deprecated usar `queryKeys.leaderboard.aroundEntry(entryId)` */
    around: () => ["leaderboard", "me", "around"] as const,
    league: (id: string, page: number) =>
      ["leaderboard", "league", id, page] as const,
  },
  leagues: {
    all: () => ["leagues"] as const,
    me: () => ["leagues", "me"] as const,
    detail: (id: string) => ["leagues", id] as const,
  },
  payments: {
    byToken: (token: string) => ["payments", "by-token", token] as const,
  },
  users: {
    publicProfile: (id: string) => ["users", id, "public-profile"] as const,
  },
  admin: {
    metrics: () => ["admin", "metrics"] as const,
    users: {
      list: (filters?: Record<string, unknown>) =>
        ["admin", "users", "list", filters ?? {}] as const,
      detail: (id: string) => ["admin", "users", id] as const,
    },
    payments: {
      list: (filters?: Record<string, unknown>) =>
        ["admin", "payments", "list", filters ?? {}] as const,
    },
    matches: {
      detail: (id: string) => ["admin", "matches", id] as const,
    },
    phases: {
      summary: () => ["admin", "phases", "summary"] as const,
    },
    prizes: () => ["admin", "prizes"] as const,
    audit: (filters?: Record<string, unknown>) =>
      ["admin", "audit", filters ?? {}] as const,
    config: () => ["admin", "config"] as const,
    notifications: {
      history: (filters?: Record<string, unknown>) =>
        ["admin", "notifications", "history", filters ?? {}] as const,
    },
  },
} as const;

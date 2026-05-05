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
  predictions: {
    all: () => ["predictions"] as const,
    me: (filters?: Record<string, unknown>) =>
      ["predictions", "me", filters ?? {}] as const,
    forMatch: (matchId: string) =>
      ["predictions", "me", "match", matchId] as const,
    special: () => ["predictions", "special", "me"] as const,
  },
  leaderboard: {
    all: () => ["leaderboard"] as const,
    global: (page: number) => ["leaderboard", "global", page] as const,
    phase: (phase: Phase, page: number) =>
      ["leaderboard", "phase", phase, page] as const,
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

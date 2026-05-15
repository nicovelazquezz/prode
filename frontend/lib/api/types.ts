/**
 * Tipos compartidos entre frontend modules. Espejan el shape que
 * devuelve el backend (Prisma + select clauses publicas). Si el
 * backend cambia un select o un DTO, esto se actualiza.
 *
 * NO importar tipos de Prisma en el frontend — duplicar string
 * literal unions como `Role`, `MatchStatus`, etc.
 */

// ── Enums (Prisma) ──────────────────────────────────────────────

export type Role = "USER" | "ADMIN";

export type UserStatus = "ACTIVE" | "INACTIVE" | "BANNED";

export type Phase =
  | "GROUPS"
  | "ROUND_32"
  | "ROUND_16"
  | "QUARTERS"
  | "SEMIS"
  | "THIRD_PLACE"
  | "FINAL";

export type MatchStatus =
  | "SCHEDULED"
  | "LOCKED"
  | "IN_PROGRESS"
  | "FINISHED"
  | "POSTPONED"
  | "CANCELLED";

export type Confederation =
  | "CONMEBOL"
  | "UEFA"
  | "CONCACAF"
  | "AFC"
  | "CAF"
  | "OFC";

export type OutcomeType =
  | "EXACT"
  | "WINNER_AND_DIFF"
  | "DRAW_DIFFERENT"
  | "WINNER_ONLY"
  | "MISS";

export type PaymentStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "REFUNDED"
  | "OVER_CAP"
  | "ORPHANED";

export type EntryStatus = "ACTIVE" | "ANNULLED";

export type PaymentMethod = "MERCADOPAGO" | "CASH" | "TRANSFER";

export type NotificationType =
  | "PAYMENT_CONFIRMED"
  | "REGISTRATION_PENDING_RECOVERY"
  | "MATCH_REMINDER"
  | "MATCH_RESULT"
  | "PHASE_WINNER"
  | "PASSWORD_RESET"
  | "ADMIN_BROADCAST";

export type NotificationStatus = "PENDING" | "SENT" | "FAILED" | "DELIVERED";

// ── Domain entities (subset publico) ───────────────────────────

export interface User {
  id: string;
  dni: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  role: Role;
  status: UserStatus;
  whatsappOptIn: boolean;
  createdAt: string; // ISO
  lastLoginAt: string | null;
}

export interface Team {
  id: string;
  fifaCode: string;
  name: string;
  shortName: string;
  flagUrl: string;
  confederation: Confederation;
  groupCode: string | null;
  fifaRanking: number | null;
}

export interface Player {
  id: string;
  /**
   * Formato flashscore: "Apellido Nombre" (ej "Messi Lionel"). Si el
   * frontend necesita "Nombre Apellido", reformatear en el cliente.
   */
  fullName: string;
  teamId: string | null;
  /**
   * Número de camiseta (1-99). Puede ser null en jugadores de la
   * lista extendida cuya camiseta no está confirmada. Útil para
   * desambiguar (ej. dos "Martinez Emiliano" con números distintos).
   */
  shirtNumber: number | null;
}

export interface Match {
  id: string;
  matchNumber: number;
  phase: Phase;
  groupCode: string | null;
  homeTeam: Team | null;
  awayTeam: Team | null;
  homeTeamLabel: string | null;
  awayTeamLabel: string | null;
  kickoffAt: string; // ISO
  predictionsLockAt: string; // ISO
  predictionsOpenAt: string | null;
  status: MatchStatus;
  scoreHome: number | null;
  scoreAway: number | null;
  venue?: string | null;
  /**
   * Ganador del partido cuando la definición no surge de los scores
   * (empate de eliminatoria resuelto por penales/decisión). Sólo se
   * setea desde `/admin/matches/:id/finish` cuando la fase es de
   * knockout y `scoreHome === scoreAway`. Para grupos o partidos con
   * diferencia de gol, queda en null y el ganador se infiere del
   * marcador.
   */
  winnerTeam?: Team | null;
  winnerTeamId?: string | null;
}

/**
 * Entry: una "boleta" / set independiente de predicciones que un user
 * compró. Un user puede tener hasta `max_entries_per_user` entries
 * (cap configurable desde admin, default 5). Predicciones, special
 * prediction y memberships de mini-ligas se asocian al `entryId`,
 * no al `userId`.
 */
export interface Entry {
  id: string;
  userId: string;
  position: number;
  alias: string | null;
  status: EntryStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * EntrySummary: shape devuelta por `GET /entries/me` y `GET /entries/:id`.
 * Incluye stats agregadas por entry (no por user) — se usa para
 * renderizar el switcher con info inline (puntos · posición) y para
 * decidir si el alias todavía es editable (`specialPredictionLocked`).
 */
export interface EntrySummary extends Entry {
  stats: {
    predictionsCount: number;
    totalPoints: number;
    /** null si la MV todavía no refrescó o el entry no tiene predictions. */
    rank: number | null;
    specialPredictionLocked: boolean;
  };
}

export interface Prediction {
  id: string;
  /**
   * El backend ahora devuelve `entryId` en lugar de `userId`. Marcado
   * opcional para que mocks legacy (tests, optimistic updates antiguos)
   * sigan compilando durante la migración a multi-prode; consumers
   * reales (página de predicciones) lo reciben siempre poblado.
   */
  entryId?: string;
  userId?: string;
  matchId: string;
  scoreHome: number;
  scoreAway: number;
  outcomeType: OutcomeType | null;
  basePoints: number;
  multiplier: number;
  pointsEarned: number;
  evaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  match?: Match;
}

export interface SpecialPrediction {
  id: string;
  /** Opcional para compat con mocks legacy; consumers reales lo reciben. */
  entryId?: string;
  userId?: string;
  championTeamId: string | null;
  runnerUpTeamId: string | null;
  thirdPlaceTeamId: string | null;
  topScorerId: string | null;
  topScorerName: string | null;
  totalGoals: number | null;
  championPoints: number;
  runnerUpPoints: number;
  thirdPlacePoints: number;
  topScorerPoints: number;
  totalGoalsPoints: number;
  totalPoints: number;
  evaluatedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
  championTeam?: Team | null;
  runnerUpTeam?: Team | null;
  thirdPlaceTeam?: Team | null;
  topScorer?: Player | null;
}

export interface League {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string;
  ownerId: string;
  isPublic: boolean;
  maxMembers: number;
  createdAt: string;
  memberCount?: number;
}

export interface LeagueMembership {
  id: string;
  leagueId: string;
  userId: string;
  joinedAt: string;
  league?: League;
}

export interface Payment {
  id: string;
  amount: number;
  status: PaymentStatus;
  method: PaymentMethod;
  payerEmail: string | null;
  payerName: string | null;
  mpPaymentId: string | null;
  initPoint: string | null;
  completionTokenHash: string | null;
  tokenExpiresAt: string | null;
  completedAt: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicStats {
  enrolledUsers: number;
  pozoEstimate: number;
}

// ── Leaderboard ────────────────────────────────────────────────

/**
 * Row of the leaderboard as exposed to UI components.
 *
 * The backend returns `{ rows: [{ user_id, first_name, ... }], total }`
 * (see backend/src/modules/leaderboard/leaderboard.service.ts). Our
 * `lib/api/leaderboard.ts` adapter maps that into this richer shape:
 *   - `position` is computed from the row index (1-based).
 *   - snake_case keys are camelCased to match the rest of our API
 *     surface.
 * UI components consume this normalized type and don't need to know
 * about the wire shape.
 */
export interface LeaderboardEntry {
  position: number;
  /**
   * ID del Entry (multi-prode); cada row del ranking es un Entry.
   * Opcional para que el adapter en transición pueda emitir filas
   * sin entryId hasta que el backend lo exponga.
   */
  entryId?: string;
  /** ID del User dueño del Entry — usado para abrir el perfil público. */
  userId: string;
  firstName: string;
  lastName: string;
  /** Alias custom del entry; null si el user no le puso nombre. */
  alias?: string | null;
  /** Posición del entry dentro del user (1..N). Para "Mi prode #2". */
  entryPosition?: number;
  totalPoints: number;
  predictionsCount?: number;
}

export interface PaginatedLeaderboard {
  page: number;
  pageSize: number;
  total: number;
  entries: LeaderboardEntry[];
}

export interface MeAroundResult {
  position: number;
  /**
   * Total de entries en el ranking global. Mantenemos el nombre
   * `totalUsers` para compatibilidad visual con el hero ("# de N"),
   * aunque conceptualmente ahora son entries.
   */
  totalUsers: number;
  totalPoints: number;
  context: LeaderboardEntry[]; // entries near the active entry
}

// ── Auth responses ─────────────────────────────────────────────

export interface AuthResponse {
  accessToken: string;
  user: User;
  /**
   * Lista de entries del user (multi-prode v1.1+). El backend la
   * incluye cuando es relevante (login, complete-registration, /auth/me).
   * Opcional para compat con tests/mocks legacy.
   */
  entries?: EntrySummary[];
}

// ── Pagination utility ─────────────────────────────────────────

/**
 * Shape returned by every backend pagination endpoint
 * (`/predictions/me`, `/admin/users`, `/admin/payments`, etc.).
 * The backend lives in `data` (not `items`) — see
 * `PaginatedUserPredictions` and friends in
 * backend/src/modules/predictions/predictions.service.ts.
 */
export interface Paginated<T> {
  page: number;
  pageSize: number;
  total: number;
  data: T[];
}

// ── Public profile ─────────────────────────────────────────────

export interface PublicProfile {
  id: string;
  firstName: string;
  lastName: string;
  predictionsFinished: Array<{
    matchId: string;
    scoreHome: number;
    scoreAway: number;
    outcomeType: OutcomeType | null;
    pointsEarned: number;
    match: Match;
  }>;
}

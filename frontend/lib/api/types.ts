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
  | "ORPHANED";

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
  fullName: string;
  teamId: string | null;
  position: string | null;
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
}

export interface Prediction {
  id: string;
  userId: string;
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
  userId: string;
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

export interface LeaderboardEntry {
  position: number;
  userId: string;
  firstName: string;
  lastName: string;
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
  totalUsers: number;
  totalPoints: number;
  context: LeaderboardEntry[]; // entries near the user
}

// ── Auth responses ─────────────────────────────────────────────

export interface AuthResponse {
  accessToken: string;
  user: User;
}

// ── Pagination utility ─────────────────────────────────────────

export interface Paginated<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
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

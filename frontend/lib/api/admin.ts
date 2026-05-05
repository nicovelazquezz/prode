import { api } from "./client";
import type {
  Match,
  MatchStatus,
  Paginated,
  Payment,
  Phase,
  User,
} from "./types";

// ── Users ──────────────────────────────────────────────────────

export async function listUsers(query?: {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
}): Promise<Paginated<User>> {
  return api
    .get("admin/users", { searchParams: cleanParams(query) })
    .json<Paginated<User>>();
}

export async function createManualUser(dto: {
  dni: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  password: string;
  amount?: number;
  method?: string;
}): Promise<User> {
  return api.post("admin/users", { json: dto }).json<User>();
}

export async function updateUser(
  id: string,
  dto: Partial<{
    firstName: string;
    lastName: string;
    whatsapp: string;
    status: string;
    role: string;
  }>,
): Promise<User> {
  return api.patch(`admin/users/${id}`, { json: dto }).json<User>();
}

// ── Payments ────────────────────────────────────────────────────

export async function listPayments(query?: {
  page?: number;
  pageSize?: number;
  status?: string;
  method?: string;
}): Promise<Paginated<Payment>> {
  return api
    .get("admin/payments", { searchParams: cleanParams(query) })
    .json<Paginated<Payment>>();
}

// ── Matches ─────────────────────────────────────────────────────

export async function getAdminMatch(id: string): Promise<Match> {
  return api.get(`admin/matches/${id}`).json<Match>();
}

export async function updateMatch(
  id: string,
  dto: Partial<{
    homeTeamId: string;
    awayTeamId: string;
    homeTeamLabel: string;
    awayTeamLabel: string;
    kickoffAt: string;
    venue: string;
    status: MatchStatus;
  }>,
): Promise<Match> {
  return api.put(`admin/matches/${id}`, { json: dto }).json<Match>();
}

export async function postponeMatch(
  id: string,
  dto: { newKickoffAt: string },
): Promise<Match> {
  return api
    .post(`admin/matches/${id}/postpone`, { json: dto })
    .json<Match>();
}

/**
 * Carga el resultado final + dispara cascada de scoring (recalc
 * de todas las predictions del match + leaderboard refresh).
 */
export async function finishMatch(
  id: string,
  dto: { scoreHome: number; scoreAway: number },
): Promise<{ ok: true }> {
  return api
    .post(`admin/matches/${id}/finish`, { json: dto })
    .json<{ ok: true }>();
}

export async function recalculateMatch(
  id: string,
): Promise<{ ok: true; predictionsAffected: number }> {
  return api
    .post(`admin/matches/${id}/recalculate`)
    .json<{ ok: true; predictionsAffected: number }>();
}

// ── Phases ──────────────────────────────────────────────────────

export async function closePhase(
  phase: Phase,
): Promise<{ ok: true; winnerUserId: string | null; amount: number }> {
  return api
    .post(`admin/phases/${phase}/close`)
    .json<{ ok: true; winnerUserId: string | null; amount: number }>();
}

// ── Leaderboard ─────────────────────────────────────────────────

export async function refreshLeaderboard(): Promise<{ ok: true }> {
  return api.post("admin/leaderboard/refresh").json<{ ok: true }>();
}

// ── Notifications ───────────────────────────────────────────────

export async function broadcastNotification(dto: {
  title: string;
  message: string;
  channel: "WHATSAPP" | "EMAIL";
}): Promise<{ queued: number }> {
  return api
    .post("admin/notifications/broadcast", { json: dto })
    .json<{ queued: number }>();
}

// ── Audit ───────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export async function listAudit(query?: {
  page?: number;
  pageSize?: number;
  entity?: string;
  action?: string;
  userId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<Paginated<AuditEntry>> {
  return api
    .get("admin/audit", { searchParams: cleanParams(query) })
    .json<Paginated<AuditEntry>>();
}

// ── Metrics ─────────────────────────────────────────────────────

export interface AdminMetrics {
  totalUsers: number;
  activeUsers: number;
  totalRevenue: number;
  predictionsLoaded: number;
  upcomingMatches: number;
}

export async function getMetrics(): Promise<AdminMetrics> {
  return api.get("admin/metrics").json<AdminMetrics>();
}

// ── Config ──────────────────────────────────────────────────────

export interface AppConfigEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string;
}

export async function listConfig(): Promise<AppConfigEntry[]> {
  return api.get("admin/config").json<AppConfigEntry[]>();
}

export async function updateConfig(
  key: string,
  value: string,
): Promise<AppConfigEntry> {
  return api
    .put(`admin/config/${key}`, { json: { value } })
    .json<AppConfigEntry>();
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

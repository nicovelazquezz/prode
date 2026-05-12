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

/**
 * User como lo devuelve la lista admin: agrega campos que solo el
 * panel admin necesita (paidAt, predictionsCount, totalPoints). El
 * backend puede que aun no devuelva todos — los marcamos opcionales.
 */
export interface AdminUser extends User {
  paidAt?: string | null;
  predictionsCount?: number;
  totalPoints?: number;
}

export async function listUsers(query?: {
  page?: number;
  pageSize?: number;
  status?: string;
  role?: string;
  search?: string;
}): Promise<Paginated<AdminUser>> {
  return api
    .get("admin/users", { searchParams: cleanParams(query) })
    .json<Paginated<AdminUser>>();
}

export async function createManualUser(dto: {
  dni: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  password: string;
  amount: number;
  paymentMethod: "CASH" | "TRANSFER";
  notes?: string;
}): Promise<User> {
  // Normalizamos el whatsapp a solo dígitos — el backend rechaza `+`,
  // espacios o guiones (regex /^\d{10,15}$/). Aceptamos cualquier input
  // razonable del admin para no obligarlo a tipear exacto.
  const payload = { ...dto, whatsapp: dto.whatsapp.replace(/\D/g, "") };
  return api.post("admin/users", { json: payload }).json<User>();
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

/**
 * Reset password de un user. Devuelve una password de 12 hex chars
 * generada por el backend (rota refresh tokens activos del user en
 * la misma TX). El admin la comunica offline.
 */
export async function resetUserPassword(
  id: string,
): Promise<{ password: string }> {
  return api
    .post(`admin/users/${id}/reset-password`)
    .json<{ password: string }>();
}

// ── Payments ────────────────────────────────────────────────────

/**
 * Payment + datos del user asociado y mpRawData crudo (solo admin).
 * El backend puede devolver `mpRawData` como cualquier shape MP — lo
 * dejamos como `unknown` y el panel lo renderiza con JSON.stringify.
 *
 * `entry`: el Entry asociado al payment (relación 1:1). Aparece en
 * payments APPROVED para habilitar la acción "Anular prode" en la UI.
 * Null si el payment no tiene entry todavía (PENDING) o ya fue
 * anulado (REFUNDED).
 */
export interface AdminPayment extends Payment {
  user?: {
    id: string;
    dni: string;
    firstName: string;
    lastName: string;
  } | null;
  entry?: {
    id: string;
    position: number;
    status: string;
  } | null;
  mpRawData?: unknown;
}

export async function listPayments(query?: {
  page?: number;
  pageSize?: number;
  status?: string;
  method?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<Paginated<AdminPayment>> {
  return api
    .get("admin/payments", { searchParams: cleanParams(query) })
    .json<Paginated<AdminPayment>>();
}

/**
 * Marca un payment manualmente como APPROVED. "Último recurso" —
 * cuando MP no replicó el webhook. Sólo opera sobre logged-in flows
 * (Payment con userId set); para anónimos el backend devuelve 400 con
 * indicación de usar POST /admin/users. Crea Entry y audit log.
 */
export async function approvePayment(
  id: string,
): Promise<{ paymentId: string; entryId: string; userId: string }> {
  return api
    .post(`admin/payments/${id}/approve`)
    .json<{ paymentId: string; entryId: string; userId: string }>();
}

/**
 * Registra un pago manual (CASH o TRANSFER) para un user que **ya
 * existe** en el sistema. Path A del flow operacional: el user pagó
 * por fuera (transferencia/efectivo) y avisó por WhatsApp; el admin
 * lo registra. Crea Payment + Entry adicional + audit log.
 *
 * Errores típicos:
 *   - 404: User no existe
 *   - 403: User no está ACTIVE
 *   - 409 con code `ENTRY_CAP_REACHED`: el user llegó al cap
 *   - 409 con code `REGISTRATION_CLOSED`: pasó la fecha de cierre
 */
export interface CreateManualPaymentDto {
  userId: string;
  method: "CASH" | "TRANSFER";
  notes?: string;
}

export interface CreateManualPaymentResponse {
  payment: {
    id: string;
    userId: string;
    amount: number;
    method: string;
    status: string;
    notes: string | null;
    createdAt: string;
  };
  entry: {
    id: string;
    userId: string;
    position: number;
    status: string;
    createdAt: string;
  };
}

export async function createManualPayment(
  dto: CreateManualPaymentDto,
): Promise<CreateManualPaymentResponse> {
  return api
    .post("admin/payments/manual", { json: dto })
    .json<CreateManualPaymentResponse>();
}

/**
 * Anula un Entry. Borra predicciones del entry + special prediction +
 * memberships en mini-ligas. El Payment asociado pasa a REFUNDED
 * (no se borra para audit). Operación destructiva — el backend genera
 * un audit log con la cantidad de predicciones afectadas.
 */
export interface AnnulEntryResponse {
  ok: true;
  entryId: string;
  userId: string;
  deletedPredictions: number;
  deletedSpecialPredictions: number;
  deletedLeagueMemberships: number;
  paymentRefunded: string | null;
}

export async function annulEntry(
  entryId: string,
): Promise<AnnulEntryResponse> {
  return api.delete(`admin/entries/${entryId}`).json<AnnulEntryResponse>();
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
 * Marca un partido como CANCELLED. Sin body — la razón es decisión externa
 * (FIFA/organizador), solo se registra la transición en audit log.
 * Idempotente: si ya estaba CANCELLED, devuelve el match sin cambios.
 * Rechaza con 400 si el partido ya está FINISHED.
 */
export async function cancelMatch(id: string): Promise<Match> {
  return api.post(`admin/matches/${id}/cancel`).json<Match>();
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

/**
 * Resumen por fase: total partidos, finalizados, top 10 puntos en
 * la fase, ganador propuesto si la fase esta lista para cerrar.
 *
 * TODO(backend): si /admin/phases/summary no existe todavia, el
 * panel muestra placeholder con todas las fases en cero hasta que
 * el endpoint este disponible.
 */
export interface PhaseSummary {
  phase: Phase;
  matchesTotal: number;
  matchesFinished: number;
  closed: boolean;
  proposedWinner: {
    userId: string;
    firstName: string;
    lastName: string;
    points: number;
  } | null;
  prizeAmount: number;
  topTen: Array<{
    userId: string;
    firstName: string;
    lastName: string;
    points: number;
  }>;
}

export async function listPhaseSummaries(): Promise<PhaseSummary[]> {
  return api.get("admin/phases/summary").json<PhaseSummary[]>();
}

// ── Prizes ──────────────────────────────────────────────────────

export interface AdminPrize {
  id: string;
  type:
    | "GENERAL_FIRST"
    | "GENERAL_SECOND"
    | "GENERAL_THIRD"
    | "PHASE_WINNER";
  phase: Phase | null;
  amount: number;
  recipientUserId: string | null;
  recipientName: string | null;
  status: "PENDING" | "PAID";
  paidAt: string | null;
}

export async function listPrizes(): Promise<AdminPrize[]> {
  // TODO(backend): GET /admin/prizes — devuelve todos los premios
  // (3 generales + 6 de fase + final) con su estado.
  return api.get("admin/prizes").json<AdminPrize[]>();
}

export async function markPrizePaid(id: string): Promise<AdminPrize> {
  // TODO(backend): POST /admin/prizes/:id/pay — marca como pagado y
  // registra audit log.
  return api.post(`admin/prizes/${id}/pay`).json<AdminPrize>();
}

// ── Leaderboard ─────────────────────────────────────────────────

export async function refreshLeaderboard(): Promise<{ ok: true }> {
  return api.post("admin/leaderboard/refresh").json<{ ok: true }>();
}

// ── Notifications ───────────────────────────────────────────────

export type NotificationSegment =
  | "ALL"
  | "PAID"
  | "PENDING"
  | "WITHOUT_PREDICTIONS";

export async function broadcastNotification(dto: {
  title: string;
  message: string;
  channel: "WHATSAPP" | "EMAIL";
  segment?: NotificationSegment;
}): Promise<{ queued: number }> {
  return api
    .post("admin/notifications/broadcast", { json: dto })
    .json<{ queued: number }>();
}

export async function sendDirectNotification(dto: {
  userId: string;
  title: string;
  message: string;
  channel: "WHATSAPP" | "EMAIL";
}): Promise<{ id: string }> {
  // TODO(backend): POST /admin/notifications/direct — enviar a 1 user.
  return api
    .post("admin/notifications/direct", { json: dto })
    .json<{ id: string }>();
}

export interface NotificationHistoryEntry {
  id: string;
  type: string;
  channel: "WHATSAPP" | "EMAIL";
  status: "PENDING" | "SENT" | "FAILED" | "DELIVERED";
  userId: string | null;
  recipientLabel: string | null;
  title: string;
  message: string;
  createdAt: string;
  sentAt: string | null;
}

export async function listNotificationHistory(query?: {
  page?: number;
  pageSize?: number;
  status?: string;
  channel?: string;
}): Promise<Paginated<NotificationHistoryEntry>> {
  // TODO(backend): GET /admin/notifications — historial paginado.
  return api
    .get("admin/notifications", { searchParams: cleanParams(query) })
    .json<Paginated<NotificationHistoryEntry>>();
}

// ── Exports ─────────────────────────────────────────────────────

/**
 * Disparar la descarga de un export CSV/PDF. Si el endpoint backend
 * no existe (404), el caller debe mostrar toast "Proximamente".
 *
 * Implementacion: fetch via api (con auth automatic), construir blob,
 * disparar `<a download>` programatico. Esto evita pasar por el
 * browser-blocking que tiene `window.open` en algunos browsers.
 *
 * TODO(backend): cuando existan, los endpoints esperados son:
 *   - GET /admin/exports/payments.csv  → text/csv
 *   - GET /admin/exports/leaderboard.pdf → application/pdf
 */
export async function downloadExport(
  endpoint: "payments.csv" | "leaderboard.pdf",
): Promise<{ url: string; filename: string }> {
  const blob = await api.get(`admin/exports/${endpoint}`).blob();
  const url = URL.createObjectURL(blob);
  return { url, filename: endpoint };
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

/**
 * Metricas del dashboard admin. El backend puede no exponer este
 * endpoint todavia; el dashboard incluye un fallback con stats
 * stubeadas si la query falla. Cuando exista, se espera el shape:
 *
 *  - totals.{users,active,pending,banned}
 *  - revenue.{total,paidUserCount}
 *  - predictions.{loaded,expected}  // expected = 104 * paidUserCount
 *  - nextMatch?: { id, kickoffAt, homeLabel, awayLabel }
 *  - sparklines.{usersByDay[],revenueByDay[]}  // cada uno: number[] de 14 dias
 */
export interface AdminMetrics {
  totals: {
    users: number;
    active: number;
    pending: number;
    banned: number;
  };
  revenue: {
    total: number;
    paidUserCount: number;
    /**
     * Desglose de recaudado por método de pago. Solo cuenta payments
     * en estado APPROVED. `count` = cantidad de payments, `total` =
     * suma de montos. Se completa con 0 si todavía no hubo pagos del
     * tipo correspondiente.
     */
    byMethod: {
      MERCADOPAGO: { total: number; count: number };
      CASH: { total: number; count: number };
      TRANSFER: { total: number; count: number };
    };
  };
  predictions: {
    loaded: number;
    expected: number;
  };
  nextMatch: {
    id: string;
    kickoffAt: string;
    homeLabel: string;
    awayLabel: string;
  } | null;
  sparklines: {
    usersByDay: number[];
    revenueByDay: number[];
  };
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
  updatedBy: string | null;
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

// ── Scoring & Phase Multiplier rules ────────────────────────────

import type { OutcomeType } from "./types";

export interface ScoringRuleEntry {
  outcomeType: OutcomeType;
  basePoints: number;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export async function listScoringRules(): Promise<ScoringRuleEntry[]> {
  return api.get("admin/scoring-rules").json<ScoringRuleEntry[]>();
}

export async function updateScoringRule(
  outcomeType: OutcomeType,
  basePoints: number,
): Promise<ScoringRuleEntry> {
  return api
    .put(`admin/scoring-rules/${outcomeType}`, { json: { basePoints } })
    .json<ScoringRuleEntry>();
}

export interface PhaseMultiplierEntry {
  phase: Phase;
  multiplier: number;
  updatedAt: string;
  updatedBy: string | null;
}

export async function listPhaseMultipliers(): Promise<PhaseMultiplierEntry[]> {
  return api.get("admin/phase-multipliers").json<PhaseMultiplierEntry[]>();
}

export async function updatePhaseMultiplier(
  phase: Phase,
  multiplier: number,
): Promise<PhaseMultiplierEntry> {
  return api
    .put(`admin/phase-multipliers/${phase}`, { json: { multiplier } })
    .json<PhaseMultiplierEntry>();
}

/**
 * Keys del schema (`special_prize_rules.key`): champion, runnerUp,
 * thirdPlace, topScorer, totalGoalsExact, totalGoalsClose.
 */
export type SpecialPrizeKey =
  | "champion"
  | "runnerUp"
  | "thirdPlace"
  | "topScorer"
  | "totalGoalsExact"
  | "totalGoalsClose";

export interface SpecialPrizeRuleEntry {
  key: SpecialPrizeKey;
  points: number;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export async function listSpecialPrizeRules(): Promise<SpecialPrizeRuleEntry[]> {
  return api
    .get("admin/special-prize-rules")
    .json<SpecialPrizeRuleEntry[]>();
}

export async function updateSpecialPrizeRule(
  key: SpecialPrizeRuleEntry["key"],
  points: number,
): Promise<SpecialPrizeRuleEntry> {
  return api
    .put(`admin/special-prize-rules/${key}`, { json: { points } })
    .json<SpecialPrizeRuleEntry>();
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

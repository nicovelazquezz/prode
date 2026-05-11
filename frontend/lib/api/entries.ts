import { api } from "./client";
import type { EntrySummary } from "./types";

/**
 * Multi-prode v1.1 — endpoints de Entry.
 *
 * Convenciones:
 *  - `getMyEntries` y `getEntry` requieren JWT. Backend valida que
 *    el `entryId` pertenece al user en `getEntry` y devuelve 403 si no.
 *  - `initEntryPayment` arma una preferencia MercadoPago para crear
 *    una nueva entry. Devuelve `initPoint` (URL a MP) y el `paymentId`
 *    interno. El frontend redirige al `initPoint`. El webhook crea la
 *    Entry cuando el pago está APPROVED — el frontend nunca crea
 *    entries directamente. Si el user llegó al cap, este endpoint
 *    devuelve 409 con `{ code: "ENTRY_CAP_REACHED", current, cap }`.
 *  - `updateEntryAlias` permite renombrar la entry hasta el kickoff
 *    inaugural (validación backend). Pasar `null` o vacío limpia el alias.
 */

export async function getMyEntries(): Promise<EntrySummary[]> {
  return api.get("entries/me").json<EntrySummary[]>();
}

export async function getEntry(id: string): Promise<EntrySummary> {
  return api.get(`entries/${id}`).json<EntrySummary>();
}

export async function updateEntryAlias(
  id: string,
  alias: string | null,
): Promise<EntrySummary> {
  return api
    .patch(`entries/${id}`, { json: { alias } })
    .json<EntrySummary>();
}

export interface InitEntryPaymentResponse {
  paymentId: string;
  initPoint: string;
}

export async function initEntryPayment(
  dto: { alias?: string | null } = {},
): Promise<InitEntryPaymentResponse> {
  return api
    .post("entries/init-payment", { json: dto })
    .json<InitEntryPaymentResponse>();
}

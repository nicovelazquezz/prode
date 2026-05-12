/**
 * Normaliza un número de teléfono que el admin/user tipeó al formato
 * E.164 sin `+` que espera el backend (regex `^\d{10,15}$`).
 *
 * Asumimos Argentina como default — el prode arranca con usuarios
 * locales. La misma función vive en el backend
 * (`backend/src/shared/utils/normalize-phone.ts`); mantener ambas
 * sincronizadas. El backend re-normaliza en el DTO via @Transform,
 * así que esto del lado del cliente es defensa adicional + UX (el
 * admin puede ver el resultado antes de guardar).
 *
 * Reglas:
 *   1. Strip todo lo que no sea dígito.
 *   2. Strip `0` inicial (los argentinos a veces escriben `0291-XXX-XXXX`).
 *   3. Si NO empieza con `549`, prependear `549`.
 */
export function normalizeArgentinePhone(input: string | undefined | null): string {
  if (typeof input !== "string") return "";
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (!digits.startsWith("549") && digits.length > 0) digits = `549${digits}`;
  return digits;
}

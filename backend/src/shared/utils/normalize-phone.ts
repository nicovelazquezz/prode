/**
 * Normaliza un número de teléfono que el admin/user tipeó al formato
 * E.164 sin `+` que esperan los DTOs y el wa-backend (regex
 * `^\d{10,15}$`, y JID `<digits>@s.whatsapp.net` para Baileys).
 *
 * Asumimos Argentina como default — el prode arranca con usuarios
 * locales. Si en algún momento se incorporan otros países, esta función
 * tiene que dejar de prepender `549` ciegamente.
 *
 * Reglas:
 *   1. Strip todo lo que no sea dígito (`+`, espacios, guiones, paréntesis).
 *   2. Strip `0` inicial (los argentinos a veces escriben `0291-XXX-XXXX`
 *      para llamada local, pero el `0` no va en formato internacional).
 *   3. Si NO empieza con `549`, prependear `549` (móviles AR).
 *
 * Ejemplos:
 *   `+54 9 291 520 5236`  → `5492915205236`
 *   `5492915205236`       → `5492915205236`   (idempotente)
 *   `2915205236`          → `5492915205236`
 *   `0291 520 5236`       → `5492915205236`
 *   `(011) 4321-5678`     → `5491143215678`
 *   `11 1234 5678`        → `5491112345678`
 *
 * Si el input es inválido (vacío, solo símbolos, etc.) devuelve un
 * string que claramente NO matchea el regex de los DTOs, así la
 * validación posterior tira el error apropiado en lugar de que el
 * normalizador trate de "adivinar" qué quiso decir el user.
 */
export function normalizeArgentinePhone(input: unknown): string {
  if (typeof input !== 'string') return '';
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (!digits.startsWith('549') && digits.length > 0) digits = `549${digits}`;
  return digits;
}

/**
 * Helpers para enmascarar PII antes de loggearlo o persistirlo en audit
 * trails. Cualquier persistencia o log que toque DNI / WhatsApp / email
 * debe pasar por estas funciones para que un dump del DB no sea un PII
 * leak channel.
 */

/**
 * Enmascara un DNI argentino para audit logs. Conserva los primeros 2
 * y últimos 3 dígitos (suficiente para que un admin reconozca el user
 * sin que un dump expose la identidad completa).
 *
 * Ejemplos:
 *   `12345678` → `12***678`
 *   `4123`     → `***`        (muy corto para enmascarar de manera útil)
 *   ``         → `***`
 */
export function maskDni(dni: string | null | undefined): string {
  if (!dni || dni.length <= 5) return '***';
  return `${dni.slice(0, 2)}***${dni.slice(-3)}`;
}

/**
 * Enmascara un WhatsApp en formato E.164 sin '+' (ej. `5492914000000`).
 * Conserva código de país (primeros 3-4) + últimos 4 dígitos.
 *
 *   `5492914000000` → `549***0000`
 *   `123`           → `***`
 */
export function maskWhatsapp(wa: string | null | undefined): string {
  if (!wa || wa.length <= 7) return '***';
  return `${wa.slice(0, 3)}***${wa.slice(-4)}`;
}

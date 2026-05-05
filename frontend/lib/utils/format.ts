/**
 * Formatters compartidos por el panel admin (y eventualmente
 * el resto de la app). Stateless puros para que sean
 * testables y referenciables desde Server Components.
 */

const ARS_FORMAT = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const NUMBER_FORMAT = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 0,
});

const DATETIME_FORMAT = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_FORMAT = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatARS(amount: number): string {
  return ARS_FORMAT.format(amount);
}

export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return DATETIME_FORMAT.format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_FORMAT.format(d);
}

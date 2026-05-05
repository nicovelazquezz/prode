import Link from "next/link";

const ADMIN_WHATSAPP = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? "";

function buildAdminWhatsApp(): string {
  const text = encodeURIComponent(
    "Hola! Intente pagar el Prode pero el pago me dio error.",
  );
  const num = ADMIN_WHATSAPP.replace(/\D/g, "");
  return num
    ? `https://wa.me/${num}?text=${text}`
    : `https://wa.me/?text=${text}`;
}

/**
 * Pagina /inscripcion/failure — backend redirige aca cuando un pago
 * MercadoPago falla (rejected o el user cancela). No hay token
 * porque el pago no se completo.
 *
 * UX: mensaje claro + CTA "Reintentar pago" que vuelve al landing
 * para iniciar de nuevo + link auxiliar a WhatsApp.
 *
 * Server Component puro (sin estado/interactividad).
 */
export default function InscripcionFailurePage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-16 md:py-24">
      <span
        aria-hidden="true"
        className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-prode-accent)] text-white text-3xl font-display font-black"
      >
        ×
      </span>
      <h1 className="font-display text-4xl md:text-6xl font-black uppercase tracking-tight text-[var(--color-prode-accent)]">
        Pago rechazado
      </h1>
      <p className="font-sans text-base md:text-lg text-[var(--color-prode-text-secondary)]">
        El pago no se pudo completar. Puede ser por fondos insuficientes,
        un error de la tarjeta o que hayas cancelado en MercadoPago.
        Intentá de nuevo desde el inicio.
      </p>

      <div className="flex flex-col gap-3 sm:max-w-xs">
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center rounded-2xl bg-[var(--color-prode-near-black)] px-8 font-sans text-sm font-medium text-white hover:opacity-90"
        >
          Reintentar pago
        </Link>
        <a
          href={buildAdminWhatsApp()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center justify-center rounded-2xl border-2 border-[var(--color-prode-border)] bg-white px-8 font-sans text-sm font-medium text-[var(--color-prode-near-black)] hover:border-[var(--color-prode-near-black)]"
        >
          Escribir al admin
        </a>
      </div>
    </div>
  );
}

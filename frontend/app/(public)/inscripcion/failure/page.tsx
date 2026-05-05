import Link from "next/link";

const ADMIN_WHATSAPP = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? "";

function buildAdminWhatsApp(): string {
  const text = encodeURIComponent(
    "Hola! Intenté pagar el Prode pero el pago me dio error.",
  );
  const num = ADMIN_WHATSAPP.replace(/\D/g, "");
  return num
    ? `https://wa.me/${num}?text=${text}`
    : `https://wa.me/?text=${text}`;
}

/**
 * Página /inscripcion/failure — backend redirige acá cuando un pago
 * MercadoPago falla (rejected o el user cancela). No hay token
 * porque el pago no se completó.
 */
export default function InscripcionFailurePage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-16 md:py-24">
      <span
        aria-hidden="true"
        className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-landing-red)] font-[family-name:var(--font-landing-display)] text-3xl text-[var(--color-landing-text)]"
      >
        ×
      </span>
      <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-red)]">
        Pago rechazado
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-4xl uppercase leading-[0.85] tracking-tight md:text-6xl">
        Algo salió mal.
      </h1>
      <p className="text-base leading-relaxed text-[var(--color-landing-text-muted)] md:text-lg">
        El pago no se pudo completar. Puede ser por fondos insuficientes,
        un error de la tarjeta o que hayas cancelado en MercadoPago.
        Intentá de nuevo desde el inicio.
      </p>

      <div className="mt-2 flex flex-col gap-3 sm:max-w-sm">
        <Link
          href="/"
          className="rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-center text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
        >
          Reintentar pago
        </Link>
        <a
          href={buildAdminWhatsApp()}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm border border-[var(--color-landing-line-strong)] px-8 py-[18px] text-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
        >
          Escribir al admin
        </a>
      </div>
    </div>
  );
}

import Link from "next/link";

/**
 * Página /inscripcion/pending — backend redirige acá cuando MP deja
 * el pago en estado "in_process" (Pago Fácil, Rapipago, transferencia,
 * etc.). El usuario tiene que esperar a que se acredite, y le llega
 * confirmación por mail.
 */
export default function InscripcionPendingPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-16 md:py-24">
      <span
        aria-hidden="true"
        className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-landing-gold)] font-[family-name:var(--font-landing-display)] text-3xl text-[var(--color-landing-bg)]"
      >
        ⌛
      </span>
      <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-gold)]">
        Procesando pago
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-4xl uppercase leading-[0.85] tracking-tight md:text-6xl">
        Pago pendiente.
      </h1>
      <p className="text-base leading-relaxed text-[var(--color-landing-text-muted)] md:text-lg">
        Tu pago está procesándose. Cuando se acredite te avisamos por
        mail con el link para completar tu registro. Si pagaste con
        efectivo, puede tardar hasta 48hs hábiles.
      </p>

      <Link
        href="/"
        className="mt-2 w-fit rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-center text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
      >
        Volver al inicio
      </Link>
    </div>
  );
}

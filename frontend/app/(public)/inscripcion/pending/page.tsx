import Link from "next/link";

/**
 * Pagina /inscripcion/pending — backend redirige aca cuando MP deja
 * el pago en estado "in_process" (Pago Facil, Rapipago, transferencia,
 * etc.). El usuario tiene que esperar a que se acredite, y le llega
 * confirmacion por mail.
 *
 * Server Component puro.
 */
export default function InscripcionPendingPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-16 md:py-24">
      <span
        aria-hidden="true"
        className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-prode-text-muted)] text-white text-3xl font-display font-black"
      >
        ⌛
      </span>
      <h1 className="font-display text-4xl md:text-6xl font-black uppercase tracking-tight text-[var(--color-prode-near-black)]">
        Pago pendiente
      </h1>
      <p className="font-sans text-base md:text-lg text-[var(--color-prode-text-secondary)]">
        Tu pago está procesándose. Cuando se acredite te avisamos por
        mail con el link para completar tu registro. Si pagaste con
        efectivo, puede tardar hasta 48hs habiles.
      </p>

      <Link
        href="/"
        className="inline-flex h-12 w-fit items-center justify-center rounded-2xl bg-[var(--color-prode-near-black)] px-8 font-sans text-sm font-medium text-white hover:opacity-90"
      >
        Volver al inicio
      </Link>
    </div>
  );
}

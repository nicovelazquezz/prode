import Link from "next/link";
import { LANDING } from "@/lib/landing/content";

/**
 * CTA final — H2 grande centrado y CTA "Quiero jugar" (variación
 * deliberada del CTA primario del hero "Inscribirme · $10.000" para
 * no repetir el mismo botón tres veces).
 */
export function FinalCTA() {
  const { final } = LANDING;
  return (
    <section
      className="px-8 py-20 text-center"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(163,61,61,0.12) 0%, transparent 60%)",
      }}
    >
      <h2 className="mb-4 font-[family-name:var(--font-landing-display)] text-[80px] uppercase leading-[0.85] tracking-tight">
        {final.titleA}
        <br />
        {final.titleB}
      </h2>
      <p className="mx-auto mb-8 max-w-[460px] text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
        {final.sub}
      </p>
      <Link
        href={final.href}
        className="inline-block rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
      >
        {final.cta}
      </Link>
    </section>
  );
}

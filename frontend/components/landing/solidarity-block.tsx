import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

/**
 * Bloque solidario — H2 con underline verde en la primera frase, H2
 * accent verde en la segunda. Cuerpo con `**bold**` para resaltar
 * el nombre del torneo y el lugar.
 */
export function SolidarityBlock() {
  const { solidario } = LANDING;
  return (
    <section
      className="border-b border-[var(--color-landing-line)] px-8 py-20"
      style={{
        background:
          "linear-gradient(180deg, transparent 0%, rgba(92,120,71,0.05) 100%), var(--color-landing-bg)",
      }}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-green)]">
          {solidario.eyebrow}
        </div>
        <h2 className="mb-6 max-w-[720px] font-[family-name:var(--font-landing-display)] text-[64px] uppercase leading-tight tracking-tight">
          {solidario.underlineFirst ? (
            <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-0.5">
              {solidario.titleA}
            </span>
          ) : (
            solidario.titleA
          )}{" "}
          <span className="text-[var(--color-landing-green)]">{solidario.titleB}</span>
        </h2>
        {solidario.body.map((paragraph, i) => (
          <p
            key={i}
            className="mb-3.5 max-w-[600px] text-base leading-relaxed text-[var(--color-landing-text)]"
          >
            {inlineBold(paragraph)}
          </p>
        ))}
        <p className="max-w-[600px] text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
          {solidario.bodyMuted}
        </p>
      </div>
    </section>
  );
}

import { LANDING } from "@/lib/landing/content";

/**
 * Sección "Predicciones especiales" — 3 cards (Campeón, Goleador,
 * Total goles) con número Anton dorado en grande.
 */
export function SpecialBets() {
  const { specials } = LANDING;
  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {specials.eyebrow}
      </div>
      <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
        {specials.title}
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {specials.cards.map((card) => (
          <div
            key={card.desc}
            className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-6 text-center"
          >
            <div className="font-[family-name:var(--font-landing-display)] text-[56px] leading-none text-[var(--color-landing-gold)]">
              {card.pts}
            </div>
            <div className="mt-1.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--color-landing-text-muted)]">
              {card.label}
            </div>
            <div className="mt-3.5 text-sm font-semibold">{card.desc}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-l-2 border-[var(--color-landing-green)] bg-[color-mix(in_srgb,var(--color-landing-green)_6%,transparent)] px-4 py-3.5 font-[family-name:var(--font-landing-mono)] text-[11px] leading-relaxed text-[var(--color-landing-text-muted)]">
        {specials.note}
      </div>
    </section>
  );
}

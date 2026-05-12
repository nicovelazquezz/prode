import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

/**
 * Sección "Cómo se juega" — 3 pasos numerados (01/02/03) con número
 * verde en Anton. ID `como-funciona` cumple el anchor del CTA del hero.
 */
export function HowItWorks() {
  const { how } = LANDING;
  return (
    <section id="como-funciona" className="border-b border-[var(--color-landing-line)]">
      <div className="px-8 pt-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
            {how.eyebrow}
          </div>
          <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
            <span className="inline-block border-b-4 border-[var(--color-landing-green)] pb-0.5">
              {how.title}
            </span>
          </h2>
        </div>
      </div>
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-px bg-[var(--color-landing-line)] md:grid-cols-3">
        {how.steps.map((step) => (
          <div key={step.n} className="bg-[var(--color-landing-bg)] px-7 py-8">
            <span className="mb-4 block font-[family-name:var(--font-landing-display)] text-[56px] leading-none text-[var(--color-landing-green)]">
              {step.n}
            </span>
            <h4 className="mb-2 text-lg font-extrabold">{step.h}</h4>
            <p className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
              {inlineBold(step.body)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

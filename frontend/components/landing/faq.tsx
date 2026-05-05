import { LANDING } from "@/lib/landing/content";

/**
 * FAQ con `<details>`/`<summary>` nativo. Accesibilidad y manejo de
 * teclado vienen sin código. El `+` rota a `×` cuando el item se abre
 * via la pseudo-clase :open + group-open.
 */
export function FAQ() {
  const { faq } = LANDING;
  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {faq.eyebrow}
      </div>
      <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
        {faq.title}
      </h2>
      <div>
        {faq.items.map((item) => (
          <details
            key={item.q}
            className="group cursor-pointer border-b border-[var(--color-landing-line)] py-4 transition-colors focus-within:bg-white/[0.02]"
          >
            <summary className="flex list-none items-center justify-between text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]">
              <span>{item.q}</span>
              <span className="text-2xl font-light text-[var(--color-landing-text-muted)] transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="mt-3 pr-8 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
              {item.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

const TOP_BORDER: Record<string, string> = {
  gold: "border-t-[var(--color-landing-gold)]",
  blue: "border-t-[var(--color-landing-blue)]",
  red: "border-t-[var(--color-landing-red)]",
};

/**
 * Sección "Premios" — 3 categorías sin %, sin montos. Tabla general,
 * Mejor de cada bloque, Aciertos especiales. Cada card con border-top
 * de color por categoría. Pie aclara que los montos exactos se anuncian
 * antes del cierre de inscripción.
 */
export function Prizes() {
  const { prizes } = LANDING;
  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {prizes.eyebrow}
      </div>
      <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
        {prizes.title}
      </h2>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        {prizes.categories.map((cat) => (
          <div
            key={cat.title.join(" ")}
            className={`rounded-sm border border-[var(--color-landing-line-strong)] border-t-[3px] bg-[var(--color-landing-surface)] p-6 ${TOP_BORDER[cat.accent]}`}
          >
            <span className="mb-3 block text-2xl">{cat.icon}</span>
            <div className="mb-3.5 font-[family-name:var(--font-landing-display)] text-[22px] uppercase leading-tight tracking-tight">
              {cat.title.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < cat.title.length - 1 && <br />}
                </span>
              ))}
            </div>
            <ul className="space-y-1 text-sm">
              {cat.items.map((item) => (
                <li
                  key={item}
                  className="relative pl-3.5 before:absolute before:left-0 before:font-bold before:text-[var(--color-landing-text-muted)] before:content-['·']"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 border-l-2 border-[var(--color-landing-green)] bg-[color-mix(in_srgb,var(--color-landing-green)_6%,transparent)] px-4 py-3.5 font-[family-name:var(--font-landing-mono)] text-[11px] leading-relaxed text-[var(--color-landing-text-muted)]">
        {inlineBold(prizes.note)}
      </div>
    </section>
  );
}

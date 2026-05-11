import Link from "next/link";
import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

const ACCENT: Record<string, string> = {
  green: "border-l-[var(--color-landing-green)]",
  blue: "border-l-[var(--color-landing-blue)]",
  red: "border-l-[var(--color-landing-red)]",
};

/**
 * Sección "Sistema de puntos" — 4 reglas en grid, cada una con su
 * acento de color en el border-left, número grande Anton a la derecha.
 * Pie con multiplicadores por fase + link al reglamento.
 */
export function PointSystem() {
  const { points } = LANDING;
  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {points.eyebrow}
      </div>
      <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
        {points.title}
      </h2>
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {points.rules.map((rule) => (
          <div
            key={rule.label}
            className={`flex items-center justify-between rounded-sm border border-l-[3px] border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-5 py-4 ${ACCENT[rule.accent]}`}
          >
            <div className="text-sm leading-tight">
              {rule.label}
              <small className="mt-1 block font-[family-name:var(--font-landing-mono)] text-[11px] text-[var(--color-landing-text-muted)]">
                {rule.small}
              </small>
            </div>
            <div className="ml-5 shrink-0 font-[family-name:var(--font-landing-display)] text-4xl leading-none">
              {rule.pts}
            </div>
          </div>
        ))}
      </div>
      <div className="border-l-2 border-[var(--color-landing-green)] bg-[color-mix(in_srgb,var(--color-landing-green)_6%,transparent)] px-4 py-3.5 font-[family-name:var(--font-landing-mono)] text-[11px] leading-relaxed text-[var(--color-landing-text-muted)]">
        {inlineBold(points.note)}{" "}
        <Link
          href={points.noteCtaHref}
          className="text-[var(--color-landing-text)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
        >
          {points.noteCta}
        </Link>
      </div>
    </section>
  );
}

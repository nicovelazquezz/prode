import { LANDING } from "@/lib/landing/content";

const COLOR_CLASS: Record<string, string> = {
  default: "text-[var(--color-landing-text)]",
  green: "text-[var(--color-landing-green)]",
  blue: "text-[var(--color-landing-blue)]",
  red: "text-[var(--color-landing-red)]",
};

/**
 * Stats lower-third — 4 datos clave en grid (8 semanas, 48 selecciones,
 * 7 fases, 1 causa). Cada uno con su acento de color.
 */
export function StatsBar() {
  return (
    <div className="grid grid-cols-2 gap-px border-y border-[var(--color-landing-line-strong)] bg-[var(--color-landing-line)] md:grid-cols-4">
      {LANDING.stats.map((stat) => (
        <div key={stat.l} className="bg-[var(--color-landing-bg)] px-6 py-7">
          <span
            className={`block font-[family-name:var(--font-landing-display)] text-[56px] leading-none ${COLOR_CLASS[stat.color] ?? COLOR_CLASS.default}`}
          >
            {stat.n}
          </span>
          <span className="mt-2 block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
            {stat.l}
          </span>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useCountdown } from "@/lib/hooks/use-countdown";
import { LANDING } from "@/lib/landing/content";

function pad(n: number | undefined) {
  return (n ?? 0).toString().padStart(2, "0");
}

/**
 * Cuenta regresiva al cierre de inscripción (mismo timestamp que el
 * kickoff del Mundial: 11/jun/26 12:00 ART).
 *
 * SSR-safe: useCountdown devuelve null hasta el primer mount cliente.
 * Mostramos "00" como placeholder durante esa ventana para evitar
 * hydration mismatch.
 *
 * aria-live="polite" permite que lectores de pantalla anuncien cambios,
 * sin spammear.
 */
export function LandingCountdown() {
  const parts = useCountdown(LANDING.countdown.targetIso);
  const cells = [
    { n: pad(parts?.days), l: "Días" },
    { n: pad(parts?.hours), l: "Horas" },
    { n: pad(parts?.minutes), l: "Min" },
    { n: pad(parts?.seconds), l: "Seg" },
  ];

  const ariaLabel =
    parts && !parts.finished
      ? `Faltan ${parts.days} días, ${parts.hours} horas, ${parts.minutes} minutos`
      : "Calculando tiempo restante";

  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          {LANDING.countdown.eyebrow}
        </div>
        <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
          {LANDING.countdown.titleA}
          <span className="block text-[var(--color-landing-text-muted)]">
            {LANDING.countdown.titleB}
          </span>
        </h2>
        <div
          className="grid grid-cols-4 gap-3"
          aria-live="polite"
          aria-atomic="true"
          aria-label={ariaLabel}
        >
          {cells.map((cell) => (
            <div
              key={cell.l}
              className="flex flex-col items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-6 text-center"
            >
              <span className="block font-[family-name:var(--font-landing-display)] text-5xl leading-none tabular-nums md:text-6xl">
                {cell.n}
              </span>
              <span className="mt-3 block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
                {cell.l}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

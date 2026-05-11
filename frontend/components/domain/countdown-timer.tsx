"use client";

import { useCountdown } from "@/lib/hooks/use-countdown";
import { cn } from "@/lib/utils/cn";

interface CountdownTimerProps {
  /** ISO 8601 string del target moment (ej kickoff). */
  targetIso: string;
  /**
   * Si `true`, omite "Days" cuando faltan menos de 24h.
   * Default `false` (siempre muestra los 4 valores).
   */
  compact?: boolean;
  /** Texto que se muestra cuando el countdown ya termino. */
  finishedLabel?: string;
  className?: string;
}

const PLACEHOLDER = "—";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/**
 * Cuenta regresiva visual estilo DESIGN.md "Countdown Timer":
 * 4 unidades (Days / Hours / Minutes / Seconds) cada una con
 * numero grande en font-display + label tracked uppercase abajo.
 *
 * SSR-safe: el primer render (server + cliente pre-mount) muestra
 * placeholders "—:—:—:—" para evitar hydration mismatch. Despues
 * del mount se actualiza cada segundo con `useCountdown()`.
 */
export function CountdownTimer({
  targetIso,
  compact = false,
  finishedLabel = "Empezo!",
  className,
}: CountdownTimerProps) {
  const parts = useCountdown(targetIso);

  if (parts?.finished) {
    return (
      <div
        className={cn(
          "font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight",
          "text-[var(--color-landing-red)]",
          className,
        )}
      >
        {finishedLabel}
      </div>
    );
  }

  const showDays = !compact || (parts?.days ?? 1) > 0;

  const units: Array<{ value: string; label: string; show: boolean }> = [
    {
      value: parts ? pad(parts.days) : PLACEHOLDER,
      label: "Dias",
      show: showDays,
    },
    {
      value: parts ? pad(parts.hours) : PLACEHOLDER,
      label: "Horas",
      show: true,
    },
    {
      value: parts ? pad(parts.minutes) : PLACEHOLDER,
      label: "Min",
      show: true,
    },
    {
      value: parts ? pad(parts.seconds) : PLACEHOLDER,
      label: "Seg",
      show: true,
    },
  ];

  return (
    <div
      className={cn(
        "inline-flex items-end gap-4 md:gap-6",
        "tabular-nums",
        className,
      )}
      role="timer"
      aria-live="off"
      aria-label={
        parts
          ? `Faltan ${parts.days} dias, ${parts.hours} horas, ${parts.minutes} minutos`
          : "Calculando tiempo restante"
      }
    >
      {units
        .filter((u) => u.show)
        .map((unit, idx) => (
          <div key={unit.label} className="flex flex-col items-center gap-1">
            <span className="font-[family-name:var(--font-landing-display)] text-4xl md:text-6xl tabular-nums leading-none text-[var(--color-landing-text)]">
              {unit.value}
            </span>
            <span className="font-[family-name:var(--font-landing-mono)] text-[10px] md:text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
              {unit.label}
            </span>
            {idx === 0 && (
              <span className="sr-only">{`${unit.label}, `}</span>
            )}
          </div>
        ))}
    </div>
  );
}

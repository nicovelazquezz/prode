"use client";

import type { Phase } from "@/lib/api/types";
import { PHASE_LABEL, PHASE_ORDER } from "@/lib/landing/available-phases";
import { cn } from "@/lib/utils/cn";

/**
 * Identificador "virtual" para la pestaña "Próx" — lista de próximos
 * partidos cross-fase. No es un Phase real.
 */
export type PhaseTabValue = "UPCOMING" | Phase;

interface PhaseTabsProps {
  value: PhaseTabValue;
  onChange: (next: PhaseTabValue) => void;
  /**
   * Fases que están habilitadas (tienen al menos un match scheduled
   * o jugado). Si no se pasa, se muestran todas — útil para tests
   * o stories aisladas. En producción, derivar con
   * `deriveAvailablePhases()` desde la lista de matches.
   */
  availablePhases?: Phase[];
  /**
   * Si false, oculta el tab "Próx". Default true.
   */
  showUpcoming?: boolean;
  className?: string;
}

const SHORT_LABEL: Partial<Record<Phase, string>> = {
  GROUPS: "Grupos",
  ROUND_32: "16avos",
  ROUND_16: "Octavos",
  QUARTERS: "Cuartos",
  SEMIS: "Semis",
  THIRD_PLACE: "3°",
  FINAL: "Final",
};

/**
 * Tabs para filtrar /predicciones por fase. Solo se muestran las
 * fases que tienen al menos un partido cargado en el sistema, así
 * el usuario no ve tabs vacíos para fases que el admin todavía no
 * habilitó.
 *
 * Visual: dark editorial — bg landing-bg, line divider, items en
 * mono uppercase tracked, active state cream + green underline.
 */
export function PhaseTabs({
  value,
  onChange,
  availablePhases,
  showUpcoming = true,
  className,
}: PhaseTabsProps) {
  const phases = availablePhases ?? PHASE_ORDER;
  const tabs: Array<{ value: PhaseTabValue; label: string }> = [
    ...(showUpcoming ? [{ value: "UPCOMING" as const, label: "Próx" }] : []),
    ...phases.map((p) => ({
      value: p,
      label: SHORT_LABEL[p] ?? PHASE_LABEL[p],
    })),
  ];

  return (
    <div
      className={cn(
        "sticky top-14 md:top-16 z-20 bg-[var(--color-landing-bg)]",
        "border-b border-[var(--color-landing-line)]",
        className,
      )}
    >
      <nav
        role="tablist"
        aria-label="Filtrar por fase"
        className={cn(
          "flex flex-nowrap gap-1 overflow-x-auto",
          "scroll-smooth snap-x snap-mandatory",
          "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
          "px-4 md:px-8",
        )}
      >
        {tabs.map((tab) => {
          const isActive = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.value)}
              className={cn(
                "snap-start shrink-0 min-h-12 px-4 py-3",
                "font-[family-name:var(--font-landing-mono)] text-[12px] uppercase tracking-[0.12em]",
                "border-b-2 -mb-px transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-landing-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-landing-bg)]",
                "cursor-pointer",
                isActive
                  ? "text-[var(--color-landing-text)] border-[var(--color-landing-green)]"
                  : "text-[var(--color-landing-text-muted)] border-transparent hover:text-[var(--color-landing-text)]",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

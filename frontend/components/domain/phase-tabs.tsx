"use client";

import type { Phase } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

/**
 * Identificador "virtual" para la pestania "Próx" — lista de proximos
 * partidos cross-fase. No es un Phase real, asi que el padre debe
 * branchear (`if (value === "UPCOMING") usar getUpcoming() else
 * getMatchesByPhase()`).
 */
export type PhaseTabValue = "UPCOMING" | Phase;

interface PhaseTabsProps {
  value: PhaseTabValue;
  onChange: (next: PhaseTabValue) => void;
  className?: string;
}

const TABS: Array<{ value: PhaseTabValue; label: string }> = [
  { value: "UPCOMING", label: "Próx" },
  { value: "GROUPS", label: "Grupos" },
  { value: "ROUND_32", label: "16avos" },
  { value: "ROUND_16", label: "Octavos" },
  { value: "QUARTERS", label: "Cuartos" },
  { value: "SEMIS", label: "Semis" },
  { value: "FINAL", label: "Final" },
];

/**
 * Tabs para filtrar /predicciones por fase. Spec §6.4. Implementacion
 * custom (no Radix Tabs) porque queremos:
 *  - Scroll horizontal con snap mobile (Radix Tabs.List no soporta
 *    overflow-x bien en touch + sticky parent).
 *  - Underline accent bajo el active.
 *  - Sticky bajo el AppHeader sin grid issues.
 *
 * Touch target: cada tab tiene minHeight 48px (≥44 WCAG).
 */
export function PhaseTabs({ value, onChange, className }: PhaseTabsProps) {
  return (
    <div
      className={cn(
        "sticky top-14 md:top-16 z-20 bg-white",
        "border-b border-[var(--color-prode-border)]",
        className,
      )}
    >
      <nav
        role="tablist"
        aria-label="Filtrar por fase"
        className={cn(
          "flex flex-nowrap gap-1 overflow-x-auto",
          // snap horizontal en mobile
          "scroll-smooth snap-x snap-mandatory",
          // hide scrollbar (cosmetic)
          "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
          "px-4 md:px-8",
        )}
      >
        {TABS.map((tab) => {
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
                "font-sans text-sm",
                "border-b-2 -mb-px transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-offset-2",
                isActive
                  ? "text-[var(--color-prode-near-black)] border-[var(--color-prode-accent)] font-bold"
                  : "text-[var(--color-prode-text-secondary)] border-transparent hover:text-[var(--color-prode-near-black)]",
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

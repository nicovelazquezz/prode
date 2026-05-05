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
 *  - Underline verde bajo el active (eyebrow editorial pattern de la
 *    landing).
 *  - Sticky bajo el AppHeader sin grid issues.
 *
 * Visual: dark editorial — bg landing-bg, line-strong divider, items
 * en mono uppercase tracked, active state cream + green underline.
 *
 * Touch target: cada tab tiene minHeight 48px (≥44 WCAG).
 */
export function PhaseTabs({ value, onChange, className }: PhaseTabsProps) {
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
                "font-[family-name:var(--font-landing-mono)] text-[12px] uppercase tracking-[0.12em]",
                "border-b-2 -mb-px transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-landing-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-landing-bg)]",
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

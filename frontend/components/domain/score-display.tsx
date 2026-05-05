"use client";

import { cn } from "@/lib/utils/cn";

interface ScoreDisplayProps {
  scoreHome: number;
  scoreAway: number;
  /**
   * Si `true`, marca este score como predicho (no oficial).
   * Visual: opacity 70 + tracking suave. Default `false` (resultado real).
   */
  isPrediction?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses: Record<NonNullable<ScoreDisplayProps["size"]>, string> = {
  sm: "text-2xl",
  md: "text-3xl md:text-4xl",
  lg: "text-5xl md:text-6xl",
};

/**
 * Score finalizado (o predicho) en monospace condensed. Layout fijo
 * "H - A" con separador visual, alineacion tabular para que digitos
 * de distinto ancho no salten.
 *
 * Usa `font-display` (Fwc 2026 Condensed) para la vibe deportiva del
 * sistema visual; tabular-nums para alineamiento.
 */
export function ScoreDisplay({
  scoreHome,
  scoreAway,
  isPrediction = false,
  size = "md",
  className,
}: ScoreDisplayProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 font-display font-black",
        "text-[var(--color-prode-near-black)]",
        "tabular-nums tracking-tight leading-none",
        sizeClasses[size],
        isPrediction && "opacity-70",
        className,
      )}
      role="status"
      aria-label={
        isPrediction
          ? `Prediccion: ${scoreHome} a ${scoreAway}`
          : `Resultado: ${scoreHome} a ${scoreAway}`
      }
    >
      <span className="min-w-[1.2em] text-right">{scoreHome}</span>
      <span className="text-[var(--color-prode-text-secondary)]" aria-hidden>
        -
      </span>
      <span className="min-w-[1.2em] text-left">{scoreAway}</span>
    </div>
  );
}

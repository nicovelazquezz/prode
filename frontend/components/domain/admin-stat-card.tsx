"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface AdminStatCardProps {
  label: string;
  value: ReactNode;
  /**
   * Valor secundario que se muestra debajo del numero principal,
   * tipicamente un comparativo ("X de Y", "+12% vs ayer", etc.).
   */
  hint?: ReactNode;
  /**
   * Sparkline opcional (recharts). El padre pasa el JSX listo —
   * este componente solo reserva el slot vertical.
   */
  sparkline?: ReactNode;
  loading?: boolean;
  /**
   * Para subray los stat cards de alerta (ej: pagos rechazados).
   */
  tone?: "default" | "alert";
  className?: string;
}

/**
 * Stat card para el dashboard admin (spec §6.11).
 *
 * Visual: dark editorial. Card con bg surface y border line-strong.
 * Numero gigante en display Oswald, label arriba en mono uppercase
 * tracked. Tone alert pone border y numero en rojo.
 */
export function AdminStatCard({
  label,
  value,
  hint,
  sparkline,
  loading,
  tone = "default",
  className,
}: AdminStatCardProps) {
  return (
    <div
      className={cn(
        "rounded-sm border bg-[var(--color-landing-surface)] p-5 md:p-6",
        tone === "alert"
          ? "border-[var(--color-landing-red)]"
          : "border-[var(--color-landing-line-strong)]",
        className,
      )}
    >
      <p className="font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {label}
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {loading ? (
            <div
              role="status"
              aria-busy="true"
              className="h-12 w-32 animate-pulse rounded-sm bg-[var(--color-landing-surface-2)]"
            />
          ) : (
            <p
              className={cn(
                "font-[family-name:var(--font-landing-display)] uppercase leading-none tracking-tight tabular-nums",
                tone === "alert"
                  ? "text-[var(--color-landing-red)]"
                  : "text-[var(--color-landing-text)]",
              )}
              style={{ fontSize: "48px" }}
            >
              {value}
            </p>
          )}
          {hint ? (
            <p className="mt-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
              {hint}
            </p>
          ) : null}
        </div>
        {sparkline ? (
          <div className="h-12 w-24 shrink-0" aria-hidden="true">
            {sparkline}
          </div>
        ) : null}
      </div>
    </div>
  );
}

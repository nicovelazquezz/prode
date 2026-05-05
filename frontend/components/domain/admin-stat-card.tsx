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
 * Stat card para el dashboard admin (spec §6.11). Numero gigante en
 * font-display 48px, label arriba en uppercase tracked, hint debajo.
 * Si se pasa `sparkline`, lo renderiza en la esquina inferior derecha.
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
        "rounded-md border bg-white p-5 md:p-6",
        tone === "alert"
          ? "border-[var(--color-prode-accent)]"
          : "border-[var(--color-prode-border)]",
        className,
      )}
    >
      <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
        {label}
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {loading ? (
            <div
              role="status"
              aria-busy="true"
              className="h-12 w-32 animate-pulse rounded bg-[var(--color-prode-surface)]"
            />
          ) : (
            <p
              className={cn(
                "font-display font-black leading-none tracking-tight tabular-nums",
                tone === "alert"
                  ? "text-[var(--color-prode-accent)]"
                  : "text-[var(--color-prode-near-black)]",
              )}
              style={{ fontSize: "48px" }}
            >
              {value}
            </p>
          )}
          {hint ? (
            <p className="mt-2 font-sans text-xs text-[var(--color-prode-text-secondary)]">
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

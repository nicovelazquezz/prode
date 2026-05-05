"use client";

import { cn } from "@/lib/utils/cn";
import type { LeaderboardEntry } from "@/lib/api/types";

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  /**
   * userId del current user. Si matchea con `entry.userId`, el row
   * se renderiza con el highlight "VOS" + sticky en el scroll.
   */
  currentUserId?: string | null;
  /**
   * Si es true, agrega `position: sticky` al row para que quede
   * visible cuando se scrollea fuera del viewport. Solo se activa
   * si es el current user.
   */
  sticky?: boolean;
  /**
   * Click en el row → padre abre drawer/sheet con perfil público.
   */
  onClick?: (userId: string) => void;
  className?: string;
}

const ACCENT_BY_POSITION: Record<number, string> = {
  1: "var(--color-landing-gold)",
  2: "var(--color-landing-text-muted)",
  3: "var(--color-landing-green)",
};

/**
 * Row de la tabla de leaderboard, estética stadium (landing mantra).
 * - Top 3: borde izquierdo de color (gold/muted/green) — guiño podio
 *   sin metales saturados anti-paleta.
 * - Current user ("VOS"): bg surface-2 + sticky cuando se scrollea.
 * - Resto: transparente sobre el bg de la tabla.
 *
 * No cambia tamaño de texto entre estados — preserva ritmo vertical.
 * Numbers en Anton tabular-nums; nombre en Inter; etiqueta "VOS" en
 * mono uppercase rojo (consistente con la landing).
 */
export function LeaderboardRow({
  entry,
  currentUserId,
  sticky = false,
  onClick,
  className,
}: LeaderboardRowProps) {
  const isCurrentUser = currentUserId === entry.userId;
  const accent = ACCENT_BY_POSITION[entry.position];

  return (
    <button
      type="button"
      onClick={() => onClick?.(entry.userId)}
      data-position={entry.position}
      data-current-user={isCurrentUser ? "true" : undefined}
      aria-label={`Posición ${entry.position}: ${entry.firstName} ${entry.lastName}, ${entry.totalPoints} puntos`}
      className={cn(
        "w-full text-left grid grid-cols-[3rem_1fr_auto] items-center gap-3",
        "px-4 py-3.5 md:px-6",
        "border-b border-[var(--color-landing-line)]",
        "border-l-[3px]",
        "transition-colors duration-200",
        "cursor-pointer",
        "hover:bg-[var(--color-landing-surface)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-landing-gold)] focus-visible:ring-inset",
        isCurrentUser
          ? "bg-[var(--color-landing-surface)] sticky top-0 z-10"
          : "bg-transparent",
        className,
      )}
      style={{
        borderLeftColor: accent ?? "transparent",
      }}
    >
      <span
        className="font-[family-name:var(--font-landing-mono)] text-sm tabular-nums leading-none text-[var(--color-landing-text-muted)]"
        style={accent ? { color: accent } : undefined}
      >
        #{entry.position}
      </span>
      <span className="flex flex-col min-w-0">
        <span
          className={cn(
            "text-sm md:text-base truncate",
            isCurrentUser
              ? "font-semibold text-[var(--color-landing-text)]"
              : "text-[var(--color-landing-text)]",
          )}
        >
          {entry.firstName} {entry.lastName}
          {isCurrentUser ? (
            <span className="ml-2 inline-block rounded-sm bg-[var(--color-landing-red)] px-2 py-0.5 align-middle font-[family-name:var(--font-landing-mono)] text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--color-landing-text)]">
              VOS
            </span>
          ) : null}
        </span>
      </span>
      <span className="font-[family-name:var(--font-landing-display)] text-2xl tabular-nums leading-none text-[var(--color-landing-text)]">
        {entry.totalPoints}{" "}
        <span className="ml-1 font-[family-name:var(--font-landing-mono)] text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
          PTS
        </span>
      </span>
    </button>
  );
}

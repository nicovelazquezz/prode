"use client";

import { cn } from "@/lib/utils/cn";
import type { LeaderboardEntry } from "@/lib/api/types";

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  /**
   * userId del current user. Si matchea con `entry.userId`, el row
   * se renderiza con el highlight "VOS" (bg accent + sticky en el
   * scroll). El sticky lo aplica el contenedor de la tabla.
   */
  currentUserId?: string | null;
  /**
   * Si es true, agrega `position: sticky` al row para que quede
   * visible cuando se scrollea fuera del viewport. Se activa
   * solo si es el current user.
   */
  sticky?: boolean;
  /**
   * Click en el row → padre abre drawer/sheet con perfil publico.
   */
  onClick?: (userId: string) => void;
  className?: string;
}

/**
 * Row de la tabla de leaderboard. Renderiza posicion + nombre +
 * puntos. Variantes:
 *  - Top 3: borde dorado/plata/bronce inferior (`border-b-4`).
 *  - "VOS" (currentUserId match): bg-accent/10 + opcionalmente
 *    sticky cuando se scrollea fuera de viewport.
 *
 * El highlight no escala el texto ni cambia el size — solo bg y
 * font-weight. Esto preserva el ritmo vertical de la tabla.
 */
export function LeaderboardRow({
  entry,
  currentUserId,
  sticky = false,
  onClick,
  className,
}: LeaderboardRowProps) {
  const isCurrentUser = currentUserId === entry.userId;
  const podiumColor = getPodiumBorderColor(entry.position);

  return (
    <button
      type="button"
      onClick={() => onClick?.(entry.userId)}
      data-position={entry.position}
      data-current-user={isCurrentUser ? "true" : undefined}
      aria-label={`Posicion ${entry.position}: ${entry.firstName} ${entry.lastName}, ${entry.totalPoints} puntos`}
      className={cn(
        "w-full text-left",
        "grid grid-cols-[3rem_1fr_auto] items-center gap-3",
        "px-4 py-3 md:px-6",
        "bg-white",
        "border-b border-[var(--color-prode-border)]",
        podiumColor && `border-b-4 ${podiumColor}`,
        isCurrentUser && "bg-[color-mix(in_srgb,var(--color-prode-accent)_10%,white)]",
        isCurrentUser && sticky && "sticky top-0 z-10 shadow-sm",
        "transition-colors duration-200",
        "hover:bg-[var(--color-prode-surface)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-inset",
        className,
      )}
    >
      <span
        className={cn(
          "font-display text-lg font-black tabular-nums leading-none",
          "text-[var(--color-prode-near-black)]",
        )}
      >
        #{entry.position}
      </span>
      <span className="flex flex-col min-w-0">
        <span
          className={cn(
            "font-sans text-sm md:text-base truncate",
            isCurrentUser
              ? "font-bold text-[var(--color-prode-near-black)]"
              : "text-[var(--color-prode-near-black)]",
          )}
        >
          {entry.firstName} {entry.lastName}
          {isCurrentUser ? (
            <span className="ml-2 inline-block rounded-pill bg-[var(--color-prode-accent)] px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wider text-white align-middle">
              VOS
            </span>
          ) : null}
        </span>
      </span>
      <span
        className={cn(
          "font-display text-lg font-black tabular-nums leading-none",
          "text-[var(--color-prode-near-black)]",
        )}
      >
        {entry.totalPoints} <span className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">PTS</span>
      </span>
    </button>
  );
}

/**
 * Color de borde para top 3. Returns Tailwind color class for the
 * `border-b-4`. Null si no es podio.
 */
function getPodiumBorderColor(position: number): string | null {
  if (position === 1) return "border-b-[#d4af37]"; // dorado
  if (position === 2) return "border-b-[#c0c0c0]"; // plata
  if (position === 3) return "border-b-[#cd7f32]"; // bronce
  return null;
}

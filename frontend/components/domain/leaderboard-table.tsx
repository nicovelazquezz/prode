"use client";

import { cn } from "@/lib/utils/cn";
import { LeaderboardRow } from "@/components/domain/leaderboard-row";
import type { LeaderboardEntry } from "@/lib/api/types";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  /**
   * userId del current user para resaltar su row con highlight
   * "VOS" + sticky.
   */
  currentUserId?: string | null;
  /**
   * Si está en true, muestra skeleton de filas. El padre lo deriva
   * de `useQuery.isLoading`.
   */
  loading?: boolean;
  /**
   * Click en row → padre abre drawer/sheet con perfil público.
   */
  onRowClick?: (userId: string) => void;
  /**
   * Texto a mostrar cuando no hay entries (post-loading). Default:
   * "Sin posiciones cargadas".
   */
  emptyMessage?: string;
  className?: string;
}

/**
 * Container de la tabla de leaderboard, estética stadium (landing
 * mantra). Renderiza header sticky + rows. Maneja estados loading
 * (skeleton de 8 filas), empty (mensaje editorial), y populated.
 *
 * El sticky del row "VOS" se aplica solo al row actual del current
 * user (LeaderboardRow internal logic).
 */
export function LeaderboardTable({
  entries,
  currentUserId,
  loading = false,
  onRowClick,
  emptyMessage = "Sin posiciones cargadas",
  className,
}: LeaderboardTableProps) {
  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Cargando tabla"
        className={cn(
          "border-y border-[var(--color-landing-line-strong)] overflow-hidden",
          className,
        )}
      >
        <TableHeader />
        <div className="flex flex-col">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="h-[58px] border-b border-[var(--color-landing-line)] bg-[var(--color-landing-surface)]/40 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div
        className={cn(
          "border border-dashed border-[var(--color-landing-line-strong)] rounded-sm bg-transparent p-8 text-center",
          className,
        )}
      >
        <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Sin datos
        </p>
        <p className="mt-3 font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-y border-[var(--color-landing-line-strong)] overflow-hidden",
        className,
      )}
      role="table"
      aria-label="Tabla de posiciones"
    >
      <TableHeader />
      <div className="relative flex flex-col" role="rowgroup">
        {entries.map((entry) => (
          <LeaderboardRow
            key={entry.userId}
            entry={entry}
            currentUserId={currentUserId}
            sticky
            onClick={onRowClick}
          />
        ))}
      </div>
    </div>
  );
}

function TableHeader() {
  return (
    <div
      role="row"
      className={cn(
        "grid grid-cols-[3rem_1fr_auto] items-center gap-3",
        "px-4 py-2.5 md:px-6",
        "border-b border-[var(--color-landing-line-strong)]",
        "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em]",
        "text-[var(--color-landing-text-muted)]",
      )}
    >
      <span>Pos</span>
      <span>Jugador</span>
      <span className="text-right">Puntos</span>
    </div>
  );
}

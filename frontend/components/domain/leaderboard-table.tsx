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
   * Si esta en true, muestra skeleton de filas. El padre lo deriva
   * de `useQuery.isLoading`.
   */
  loading?: boolean;
  /**
   * Click en row → padre abre drawer/sheet con perfil publico.
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
 * Container de la tabla de leaderboard. Renderiza header + rows.
 * Maneja estados loading (skeleton de 8 filas), empty (mensaje),
 * y populated (rows reales).
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
          "rounded-md border border-[var(--color-prode-border)] bg-white overflow-hidden",
          className,
        )}
      >
        <TableHeader />
        <div className="flex flex-col">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="h-14 border-b border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] animate-pulse"
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
          "rounded-md border border-dashed border-[var(--color-prode-border)] bg-white p-8 text-center",
          className,
        )}
      >
        <p className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          Sin datos
        </p>
        <p className="mt-2 font-sans text-sm text-[var(--color-prode-text-secondary)]">
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border border-[var(--color-prode-border)] bg-white overflow-hidden",
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
        "px-4 py-2 md:px-6",
        "bg-[var(--color-prode-surface)]",
        "border-b border-[var(--color-prode-border)]",
        "font-sans text-[11px] font-bold uppercase tracking-wider",
        "text-[var(--color-prode-text-secondary)]",
      )}
    >
      <span>POS</span>
      <span>JUGADOR</span>
      <span className="text-right">PUNTOS</span>
    </div>
  );
}

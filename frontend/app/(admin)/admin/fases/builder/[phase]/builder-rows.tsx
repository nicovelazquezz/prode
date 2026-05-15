"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import { TeamFlag } from "@/components/domain/team-flag";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { Phase, Team } from "@/lib/api/types";

// El TeamSelectModal incluye 48 banderas — lazy load para no impactar
// el bundle inicial del admin.
const TeamSelectModal = dynamic(
  () =>
    import("@/components/domain/team-select-modal").then(
      (m) => m.TeamSelectModal,
    ),
);

const PHASE_LABELS: Record<Phase, string> = {
  GROUPS: "Grupos",
  ROUND_32: "16avos",
  ROUND_16: "Octavos",
  QUARTERS: "Cuartos",
  SEMIS: "Semis",
  THIRD_PLACE: "Tercer puesto",
  FINAL: "Final",
};

export interface BuilderRowState {
  matchId: string;
  matchNumber: number;
  matchPhase: Phase;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamLabel: string | null;
  awayTeamLabel: string | null;
  kickoffAt: string;
  venue: string | null;
}

interface BuilderRowsProps {
  rows: BuilderRowState[];
  setRows: (next: BuilderRowState[]) => void;
  /** Set de matchIds con conflicto (home===away o duplicate cross-row). */
  conflicts: Set<string>;
  /** 48 teams del torneo (derivados de los matches de GROUPS). */
  teams: Team[];
}

interface OpenSlot {
  rowIndex: number;
  side: "home" | "away";
}

/**
 * Lista de cruces del builder. Cada row tiene dos slots (home/away)
 * que abren el `TeamSelectModal` compartido — mismo picker que usa
 * `/admin/partidos/[id]` para asignar equipos.
 *
 * Bordes en rojo cuando el `matchId` aparece en `conflicts` (lo computa
 * el cliente padre en cada render, sin debounce — son ≤16 rows).
 *
 * Si los matches vienen de phase=FINAL incluyen tanto THIRD_PLACE como
 * FINAL: los agrupamos visualmente con un separator entre ambos.
 */
export function BuilderRows({
  rows,
  setRows,
  conflicts,
  teams,
}: BuilderRowsProps) {
  const [openSlot, setOpenSlot] = useState<OpenSlot | null>(null);

  // Agrupamos por matchPhase para que el builder de FINAL muestre
  // claramente "Tercer puesto" arriba y "Final" debajo.
  const phases = Array.from(new Set(rows.map((r) => r.matchPhase)));

  const update = (rowIndex: number, side: "home" | "away", teamId: string | null) => {
    const next = rows.map((r, i) =>
      i === rowIndex
        ? {
            ...r,
            ...(side === "home"
              ? { homeTeamId: teamId }
              : { awayTeamId: teamId }),
          }
        : r,
    );
    setRows(next);
  };

  return (
    <div className="space-y-6">
      {phases.map((phase) => {
        const phaseRows = rows
          .map((r, i) => ({ row: r, index: i }))
          .filter((x) => x.row.matchPhase === phase);
        return (
          <section key={phase} className="space-y-3">
            {phases.length > 1 ? (
              <h3 className="font-[family-name:var(--font-landing-display)] text-base uppercase tracking-tight text-[var(--color-landing-text)]">
                {PHASE_LABELS[phase]}
              </h3>
            ) : null}
            {phaseRows.map(({ row, index }) => (
              <BuilderRow
                key={row.matchId}
                row={row}
                conflict={conflicts.has(row.matchId)}
                onOpenSlot={(side) => setOpenSlot({ rowIndex: index, side })}
                onClear={(side) => update(index, side, null)}
                teams={teams}
              />
            ))}
          </section>
        );
      })}

      <TeamSelectModal
        open={openSlot !== null}
        onOpenChange={(o) => !o && setOpenSlot(null)}
        teams={teams}
        excludeTeamIds={
          openSlot
            ? rows
                .flatMap((r, i) =>
                  i === openSlot.rowIndex
                    ? // En la misma fila, sólo excluimos el slot
                      // contrario. El slot actual no se excluye para
                      // que aparezca como "seleccionado".
                      [
                        openSlot.side === "home"
                          ? r.awayTeamId
                          : r.homeTeamId,
                      ]
                    : [r.homeTeamId, r.awayTeamId],
                )
                .filter((id): id is string => id !== null)
            : []
        }
        selectedTeamId={
          openSlot
            ? openSlot.side === "home"
              ? rows[openSlot.rowIndex]?.homeTeamId ?? null
              : rows[openSlot.rowIndex]?.awayTeamId ?? null
            : null
        }
        onSelect={(t) => {
          if (!openSlot) return;
          update(openSlot.rowIndex, openSlot.side, t.id);
          setOpenSlot(null);
        }}
        title={
          openSlot
            ? openSlot.side === "home"
              ? "Asignar equipo local"
              : "Asignar equipo visitante"
            : "Asignar equipo"
        }
      />
    </div>
  );
}

function BuilderRow({
  row,
  conflict,
  onOpenSlot,
  onClear,
  teams,
}: {
  row: BuilderRowState;
  conflict: boolean;
  onOpenSlot: (side: "home" | "away") => void;
  onClear: (side: "home" | "away") => void;
  teams: Team[];
}) {
  const home = row.homeTeamId
    ? teams.find((t) => t.id === row.homeTeamId)
    : null;
  const away = row.awayTeamId
    ? teams.find((t) => t.id === row.awayTeamId)
    : null;
  const both = home && away;
  return (
    <div
      className={cn(
        "rounded-sm border bg-[var(--color-landing-surface)] p-4 transition-colors",
        conflict
          ? "border-[var(--color-landing-red)]"
          : "border-[var(--color-landing-line-strong)]",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
        <span>
          Partido #{row.matchNumber}
          {row.homeTeamLabel && row.awayTeamLabel ? (
            <span className="ml-2 text-[var(--color-landing-text-muted)]">
              · {row.homeTeamLabel} vs {row.awayTeamLabel}
            </span>
          ) : null}
        </span>
        <StatusBadge complete={Boolean(both)} conflict={conflict} />
      </div>
      <div className="mt-1 font-sans text-[11px] text-[var(--color-landing-text-muted)]">
        {formatDateTime(row.kickoffAt)}
        {row.venue ? <span className="ml-2">· {row.venue}</span> : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <SlotButton
          label="Local"
          team={home}
          placeholderLabel={row.homeTeamLabel}
          onOpen={() => onOpenSlot("home")}
          onClear={() => onClear("home")}
          conflict={conflict}
        />
        <span className="hidden text-center font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] sm:block">
          vs
        </span>
        <SlotButton
          label="Visitante"
          team={away}
          placeholderLabel={row.awayTeamLabel}
          onOpen={() => onOpenSlot("away")}
          onClear={() => onClear("away")}
          conflict={conflict}
        />
      </div>
    </div>
  );
}

function SlotButton({
  label,
  team,
  placeholderLabel,
  onOpen,
  onClear,
  conflict,
}: {
  label: string;
  team: Team | null | undefined;
  placeholderLabel: string | null;
  onOpen: () => void;
  onClear: () => void;
  conflict: boolean;
}) {
  return (
    <div>
      <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
        {label}
      </span>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "mt-1 flex w-full items-center gap-3 rounded-sm border bg-[var(--color-landing-surface-2)] p-3 text-left transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
          conflict
            ? "border-[var(--color-landing-red)]"
            : "border-[var(--color-landing-line-strong)]",
        )}
      >
        {team ? (
          <>
            <TeamFlag fifaCode={team.fifaCode} src={team.flagUrl} size={28} />
            <span className="flex-1 font-[family-name:var(--font-landing-display)] text-base uppercase tracking-tight text-[var(--color-landing-text)] truncate">
              {team.name}
            </span>
          </>
        ) : (
          <>
            <span
              className="h-7 w-7 shrink-0 rounded-sm border border-dashed border-[var(--color-landing-line)] bg-[var(--color-landing-bg)]"
              aria-hidden
            />
            <span className="flex-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
              {placeholderLabel
                ? `Slot: ${placeholderLabel}`
                : "Asignar equipo"}
            </span>
          </>
        )}
        <ChevronDown
          className="h-4 w-4 shrink-0 text-[var(--color-landing-text-muted)]"
          aria-hidden
        />
      </button>
      {team ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-red)] transition-colors"
        >
          Limpiar
        </button>
      ) : null}
    </div>
  );
}

function StatusBadge({
  complete,
  conflict,
}: {
  complete: boolean;
  conflict: boolean;
}) {
  if (conflict) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-landing-red)] px-2 py-0.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-red)]">
        <AlertCircle className="h-3 w-3" aria-hidden /> Conflicto
      </span>
    );
  }
  if (complete) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-landing-green)] px-2 py-0.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-green)]">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> Asignado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-landing-gold)] px-2 py-0.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-gold)]">
      Incompleto
    </span>
  );
}

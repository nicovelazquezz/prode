"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  applyBuilder,
  getBuilderState,
  type BuilderPhase,
  type BuilderState,
} from "@/lib/api/admin";
import { getMatchesByPhase } from "@/lib/api/matches";
import type { Phase, Team } from "@/lib/api/types";
import { GroupsReference } from "./groups-reference";
import { PreviousRoundReference } from "./previous-round-reference";
import { BuilderRows, type BuilderRowState } from "./builder-rows";

const PHASE_LABELS: Record<BuilderPhase, string> = {
  ROUND_32: "16avos",
  ROUND_16: "Octavos",
  QUARTERS: "Cuartos",
  SEMIS: "Semifinales",
  FINAL: "Final y 3er puesto",
};

interface BuilderClientProps {
  phase: BuilderPhase;
}

/**
 * Cliente principal del builder. Encapsula:
 *  - Fetch del estado del builder (`getBuilderState`).
 *  - State local de los `rows` editables, hidratado al landing y
 *    re-hidratado cuando el server data cambia (refetch).
 *  - Cómputo en cada render de `conflicts` (duplicate cross-row y
 *    home === away) — son ≤16 rows, no hace falta debouncing.
 *  - Mutación `applyBuilder` con toast + invalidación de matches y
 *    del propio builder al éxito.
 *
 * Layout:
 *  - Desktop (lg+): split 2fr referencia / 3fr builder.
 *  - Mobile: stack vertical (referencia arriba).
 */
export function BuilderClient({ phase }: BuilderClientProps) {
  const qc = useQueryClient();

  const stateQuery = useQuery({
    queryKey: queryKeys.admin.fases.builder(phase),
    queryFn: () => getBuilderState(phase),
  });

  // Lista de los 48 teams del torneo — la derivamos de los matches de
  // fase de grupos (cada team aparece al menos una vez). Mismo patrón
  // que `/admin/partidos/[id]/page.tsx`. Cache largo: los teams no
  // cambian durante el torneo.
  const teamsQuery = useQuery({
    queryKey: queryKeys.matches.byPhase("GROUPS" as Phase),
    queryFn: () => getMatchesByPhase("GROUPS"),
    staleTime: 5 * 60_000,
  });
  const teams = useMemo<Team[]>(() => {
    const map = new Map<string, Team>();
    for (const m of teamsQuery.data ?? []) {
      if (m.homeTeam) map.set(m.homeTeam.id, m.homeTeam);
      if (m.awayTeam) map.set(m.awayTeam.id, m.awayTeam);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [teamsQuery.data]);

  const [rows, setRows] = useState<BuilderRowState[]>([]);
  // Re-hidratamos rows cada vez que el server data cambia. Si el admin
  // tenía cambios sin guardar y el server refetcheó, esos cambios se
  // pierden — aceptable porque el refetch sólo ocurre por invalidación
  // explícita (no hay polling sobre este endpoint).
  useEffect(() => {
    if (stateQuery.data) {
      setRows(
        stateQuery.data.matches.map((m) => ({
          matchId: m.matchId,
          matchNumber: m.matchNumber,
          matchPhase: m.matchPhase,
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
          homeTeamLabel: m.homeTeamLabel,
          awayTeamLabel: m.awayTeamLabel,
          kickoffAt: m.kickoffAt,
          venue: m.venue,
        })),
      );
    }
  }, [stateQuery.data]);

  const conflicts = useMemo(() => computeConflicts(rows), [rows]);
  const hasDiff = useMemo(
    () => computeHasDiff(rows, stateQuery.data),
    [rows, stateQuery.data],
  );

  const applyMutation = useMutation({
    mutationFn: () =>
      applyBuilder(
        phase,
        rows.map((r) => ({
          matchId: r.matchId,
          homeTeamId: r.homeTeamId,
          awayTeamId: r.awayTeamId,
        })),
      ),
    onSuccess: (res) => {
      toast.success(
        res.matchesUpdated === 0
          ? "Sin cambios — ya estaba todo guardado"
          : `${res.matchesUpdated} ${res.matchesUpdated === 1 ? "cruce guardado" : "cruces guardados"}`,
      );
      qc.invalidateQueries({ queryKey: queryKeys.admin.fases.builder(phase) });
      qc.invalidateQueries({ queryKey: queryKeys.matches.all() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.phases.summary() });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos guardar los cruces.");
    },
  });

  const canSave =
    conflicts.size === 0 && hasDiff && !applyMutation.isPending && !stateQuery.isLoading;

  if (stateQuery.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-busy="true">
        <div className="h-12 w-1/3 animate-pulse rounded bg-[var(--color-landing-surface)]" />
        <div className="h-96 animate-pulse rounded bg-[var(--color-landing-surface)]" />
      </div>
    );
  }

  if (stateQuery.isError || !stateQuery.data) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-8 text-center">
        <p className="font-sans text-sm text-[var(--color-landing-text-muted)]">
          No pudimos cargar el builder de {PHASE_LABELS[phase]}.
        </p>
        <p className="mt-2 font-sans text-xs text-[var(--color-landing-text-muted)]">
          {stateQuery.error instanceof Error
            ? stateQuery.error.message
            : "Error desconocido"}
        </p>
        <Link
          href="/admin/fases"
          className="mt-4 inline-flex items-center gap-2 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-landing-text)] underline"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Volver a fases
        </Link>
      </div>
    );
  }

  const data = stateQuery.data;
  const assignedRows = rows.filter(
    (r) => r.homeTeamId !== null && r.awayTeamId !== null,
  ).length;

  return (
    <div className="space-y-6 pb-32">
      <header>
        <Link
          href="/admin/fases"
          className="inline-flex items-center gap-2 mb-3 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Volver a fases
        </Link>
        <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Armar cruces
        </div>
        <h1 className="font-[family-name:var(--font-landing-display)] text-3xl md:text-4xl uppercase tracking-tight text-[var(--color-landing-text)]">
          {PHASE_LABELS[phase]}
        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
          {assignedRows} de {rows.length} cruces con equipos asignados.
          {conflicts.size > 0 ? (
            <span className="ml-2 text-[var(--color-landing-red)]">
              {conflicts.size} con conflictos.
            </span>
          ) : null}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
        <aside className="min-w-0">
          {data.reference.type === "GROUPS" ? (
            <GroupsReference standings={data.reference.standings} />
          ) : (
            <PreviousRoundReference
              previousPhase={data.reference.previousPhase}
              matches={data.reference.matches}
              showLoser={phase === "FINAL"}
            />
          )}
        </aside>

        <main className="min-w-0">
          <BuilderRows
            rows={rows}
            setRows={setRows}
            conflicts={conflicts}
            teams={teams}
          />
        </main>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-[var(--color-landing-line-strong)] bg-[var(--color-landing-bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <p className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
            {hasDiff
              ? "Hay cambios sin guardar"
              : "Sin cambios"}
          </p>
          <Button
            type="button"
            variant="primary"
            onClick={() => applyMutation.mutate()}
            disabled={!canSave}
          >
            {applyMutation.isPending ? "Guardando..." : "Guardar cruces"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Devuelve el set de `matchId`s con conflicto. Dos tipos:
 *  - home === away en la misma fila (cuando ambos no son null).
 *  - mismo team usado en dos filas distintas (excluye null).
 *
 * Ambos extremos del conflicto se marcan — si el team X está en la
 * fila A (home) y en la fila B (away), ambos matchIds quedan en el set.
 */
function computeConflicts(rows: BuilderRowState[]): Set<string> {
  const conflicts = new Set<string>();
  // home === away
  for (const r of rows) {
    if (
      r.homeTeamId !== null &&
      r.awayTeamId !== null &&
      r.homeTeamId === r.awayTeamId
    ) {
      conflicts.add(r.matchId);
    }
  }
  // duplicated team across rows
  const occurrences = new Map<string, string[]>();
  for (const r of rows) {
    for (const tid of [r.homeTeamId, r.awayTeamId]) {
      if (!tid) continue;
      const list = occurrences.get(tid) ?? [];
      list.push(r.matchId);
      occurrences.set(tid, list);
    }
  }
  for (const [, matchIds] of occurrences) {
    if (matchIds.length > 1) {
      for (const id of matchIds) conflicts.add(id);
    }
  }
  return conflicts;
}

function computeHasDiff(
  rows: BuilderRowState[],
  data: BuilderState | undefined,
): boolean {
  if (!data) return false;
  if (rows.length !== data.matches.length) return true;
  const original = new Map(data.matches.map((m) => [m.matchId, m]));
  for (const r of rows) {
    const o = original.get(r.matchId);
    if (!o) return true;
    if (o.homeTeamId !== r.homeTeamId || o.awayTeamId !== r.awayTeamId) {
      return true;
    }
  }
  return false;
}

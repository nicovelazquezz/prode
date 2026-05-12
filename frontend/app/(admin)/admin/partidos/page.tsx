"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Plus } from "lucide-react";
import {
  AdminDataTable,
  RowActionsCell,
} from "@/components/domain/admin-data-table";
import { PhaseTabs, type PhaseTabValue } from "@/components/domain/phase-tabs";
import { TeamFlag } from "@/components/domain/team-flag";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import {
  createMatch,
  getMatchesByPhase,
  getUpcomingMatches,
} from "@/lib/api/matches";
import { queryKeys } from "@/lib/api/queryKeys";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { Match, MatchStatus, Phase } from "@/lib/api/types";

const PHASE_OPTIONS: Phase[] = [
  "GROUPS",
  "ROUND_32",
  "ROUND_16",
  "QUARTERS",
  "SEMIS",
  "THIRD_PLACE",
  "FINAL",
];

/**
 * Lista de partidos admin (spec §6.11). Tabs por fase reusados de
 * /predicciones. Cada fila tiene CTA "Detalle" que lleva al editor.
 *
 * Mobile: tabs scroll horizontal, tabla con scroll horizontal.
 */
export default function AdminPartidosPage() {
  const [tab, setTab] = useState<PhaseTabValue>("UPCOMING");
  const [createOpen, setCreateOpen] = useState(false);

  const matchesQuery = useQuery<Match[]>({
    queryKey:
      tab === "UPCOMING"
        ? queryKeys.matches.upcoming()
        : queryKeys.matches.byPhase(tab),
    queryFn: () =>
      tab === "UPCOMING"
        ? getUpcomingMatches({ limit: 60 })
        : getMatchesByPhase(tab as Phase),
    staleTime: 30_000,
  });

  const columns = useMemo<ColumnDef<Match, unknown>[]>(
    () => [
      {
        header: "#",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-xs text-[var(--color-landing-text-muted)]">
            {formatNumber(row.original.matchNumber)}
          </span>
        ),
      },
      {
        header: "Fecha",
        cell: ({ row }) => (
          <span className="font-sans text-xs">
            {formatDateTime(row.original.kickoffAt)}
          </span>
        ),
      },
      {
        header: "Local",
        cell: ({ row }) => <TeamCell match={row.original} side="home" />,
      },
      {
        header: "Visitante",
        cell: ({ row }) => <TeamCell match={row.original} side="away" />,
      },
      {
        header: "Sede",
        cell: ({ row }) => (
          <span className="font-sans text-xs text-[var(--color-landing-text-muted)]">
            {row.original.venue ?? "—"}
          </span>
        ),
      },
      {
        header: "Estado",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        header: "Resultado",
        cell: ({ row }) => {
          const m = row.original;
          if (m.scoreHome === null || m.scoreAway === null) return "—";
          return (
            <span className="font-mono font-bold tabular-nums">
              {m.scoreHome} - {m.scoreAway}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (
          <RowActionsCell>
            <Link
              href={`/admin/partidos/${row.original.id}`}
              aria-label={`Editar partido ${row.original.matchNumber}`}
              className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-3 py-1 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-landing-text)] hover:bg-[var(--color-landing-surface)]"
            >
              Detalle
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </RowActionsCell>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">Fixture</div>
          <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
              Partidos
            </span>
          </h1>
          <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
            Cargar resultados, asignar equipos, recalcular puntos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-sm bg-[var(--color-landing-gold)] px-5 py-2.5 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-on-gold,#000)] transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Crear partido
        </button>
      </header>

      <div className="-mx-4 md:-mx-8">
        <PhaseTabs value={tab} onChange={setTab} />
      </div>

      <AdminDataTable
        data={matchesQuery.data ?? []}
        columns={columns}
        loading={matchesQuery.isLoading}
        emptyMessage="No hay partidos para esta fase."
        ariaLabel="Tabla de partidos"
      />

      <CreateMatchDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

/**
 * Modal de creación de partido. Pensado para cargar partidos sueltos
 * o futuros (fases siguientes con equipos por definir). Para el seed
 * completo del Mundial (104 matches) se usa `prisma/seed-matches.ts`.
 *
 * homeTeamLabel / awayTeamLabel: si tipeás un fifaCode válido (3 letras
 * mayúsculas, ej "ARG"), el backend resuelve el teamId contra la tabla
 * teams. Sino queda como label crudo ("Ganador R16-1", "Eq A1").
 */
function CreateMatchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("GROUPS");
  const [groupCode, setGroupCode] = useState("");
  const [homeTeamLabel, setHomeTeamLabel] = useState("");
  const [awayTeamLabel, setAwayTeamLabel] = useState("");
  const [kickoffAt, setKickoffAt] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      createMatch({
        phase,
        groupCode: phase === "GROUPS" ? groupCode.trim() || undefined : undefined,
        homeTeamLabel: homeTeamLabel.trim(),
        awayTeamLabel: awayTeamLabel.trim(),
        kickoffAt: new Date(kickoffAt).toISOString(),
        venue: venue.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Partido creado");
      queryClient.invalidateQueries({ queryKey: queryKeys.matches.all() });
      // Limpiar form y cerrar.
      setGroupCode("");
      setHomeTeamLabel("");
      setAwayTeamLabel("");
      setKickoffAt("");
      setVenue("");
      setCity("");
      setCountry("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos crear el partido");
    },
  });

  const canSubmit =
    homeTeamLabel.trim().length > 0 &&
    awayTeamLabel.trim().length > 0 &&
    kickoffAt.length > 0 &&
    !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          <span className="inline-block border-b-[3px] border-[var(--color-landing-gold)] pb-1">
            Crear partido
          </span>
        </DialogTitle>
        <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
          Cargá un partido nuevo. Si los equipos están en la tabla de
          selecciones, usá su código FIFA de 3 letras (ARG, BRA, MEX,
          etc.); si la llave aún no se definió, podés poner un
          placeholder ("Ganador R16-1") y editarlo después.
        </DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
          className="mt-4 space-y-4"
          noValidate
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="create-phase"
                className="block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                Fase
              </label>
              <select
                id="create-phase"
                value={phase}
                onChange={(e) => setPhase(e.target.value as Phase)}
                className="mt-1 h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-landing-gold)]"
              >
                {PHASE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            {phase === "GROUPS" ? (
              <div>
                <label
                  htmlFor="create-group"
                  className="block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
                >
                  Grupo
                </label>
                <Input
                  id="create-group"
                  value={groupCode}
                  onChange={(e) => setGroupCode(e.target.value.toUpperCase())}
                  placeholder="A"
                  maxLength={4}
                  className="mt-1"
                />
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="create-home"
                className="block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                Local
              </label>
              <Input
                id="create-home"
                value={homeTeamLabel}
                onChange={(e) => setHomeTeamLabel(e.target.value)}
                placeholder='ARG o "Ganador R16-1"'
                className="mt-1"
              />
            </div>
            <div>
              <label
                htmlFor="create-away"
                className="block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                Visitante
              </label>
              <Input
                id="create-away"
                value={awayTeamLabel}
                onChange={(e) => setAwayTeamLabel(e.target.value)}
                placeholder='BRA o "2do Grupo C"'
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="create-kickoff"
              className="block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
            >
              Fecha y hora del kickoff
            </label>
            <Input
              id="create-kickoff"
              type="datetime-local"
              value={kickoffAt}
              onChange={(e) => setKickoffAt(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 font-[family-name:var(--font-landing-mono)] text-[10px] text-[var(--color-landing-text-muted)]">
              Las predicciones cierran 10 min antes del kickoff (automático).
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label
                htmlFor="create-venue"
                className="block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                Sede (opc.)
              </label>
              <Input
                id="create-venue"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Azteca"
                className="mt-1"
              />
            </div>
            <div>
              <label
                htmlFor="create-city"
                className="block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                Ciudad (opc.)
              </label>
              <Input
                id="create-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="CDMX"
                className="mt-1"
              />
            </div>
            <div>
              <label
                htmlFor="create-country"
                className="block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                País (opc.)
              </label>
              <Input
                id="create-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="México"
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-5 py-2.5 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center justify-center rounded-sm bg-[var(--color-landing-gold)] px-5 py-2.5 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-on-gold,#000)] transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? "Creando…" : "Crear partido"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeamCell({ match, side }: { match: Match; side: "home" | "away" }) {
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  const label =
    side === "home" ? match.homeTeamLabel : match.awayTeamLabel;
  if (team) {
    return (
      <span className="inline-flex items-center gap-2">
        <TeamFlag fifaCode={team.fifaCode} src={team.flagUrl} size={20} />
        <span className="font-medium">{team.shortName}</span>
      </span>
    );
  }
  return (
    <span className="font-sans text-xs italic text-[var(--color-landing-text-muted)]">
      {label ?? "TBD"}
    </span>
  );
}

function StatusBadge({ status }: { status: MatchStatus }) {
  const styles: Record<MatchStatus, string> = {
    SCHEDULED:
      "bg-[var(--color-landing-surface)] text-[var(--color-landing-text-muted)]",
    LOCKED:
      "bg-[var(--color-landing-surface)] text-[var(--color-landing-text-muted)]",
    IN_PROGRESS: "bg-[var(--color-landing-red)] text-[var(--color-landing-text)]",
    FINISHED: "bg-[var(--color-landing-green)] text-[var(--color-landing-text)]",
    POSTPONED:
      "bg-[var(--color-landing-surface)] text-[var(--color-landing-text-muted)]",
    CANCELLED: "bg-[var(--color-landing-red)] text-[var(--color-landing-text)]",
  };
  return (
    <span
      className={cn(
        "inline-block rounded-sm px-2 py-1 font-sans text-[10px] font-bold uppercase tracking-wider",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}

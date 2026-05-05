"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ArrowRight } from "lucide-react";
import {
  AdminDataTable,
  RowActionsCell,
} from "@/components/domain/admin-data-table";
import { PhaseTabs, type PhaseTabValue } from "@/components/domain/phase-tabs";
import { TeamFlag } from "@/components/domain/team-flag";
import {
  getMatchesByPhase,
  getUpcomingMatches,
} from "@/lib/api/matches";
import { queryKeys } from "@/lib/api/queryKeys";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { Match, MatchStatus, Phase } from "@/lib/api/types";

/**
 * Lista de partidos admin (spec §6.11). Tabs por fase reusados de
 * /predicciones. Cada fila tiene CTA "Detalle" que lleva al editor.
 *
 * Mobile: tabs scroll horizontal, tabla con scroll horizontal.
 */
export default function AdminPartidosPage() {
  const [tab, setTab] = useState<PhaseTabValue>("UPCOMING");

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
      <header>
        <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">Fixture</div>

        <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">

          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">

            Partidos

          </span>

        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
          Cargar resultados, asignar equipos, recalcular puntos.
        </p>
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
    </div>
  );
}

function TeamCell({ match, side }: { match: Match; side: "home" | "away" }) {
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  const label =
    side === "home" ? match.homeTeamLabel : match.awayTeamLabel;
  if (team) {
    return (
      <span className="inline-flex items-center gap-2">
        <TeamFlag fifaCode={team.fifaCode} size={20} />
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

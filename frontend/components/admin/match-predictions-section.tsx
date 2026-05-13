"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Check, RefreshCw, Search, X } from "lucide-react";
import { AdminDataTable } from "@/components/domain/admin-data-table";
import { Pagination } from "@/components/domain/pagination";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  getMatchPredictions,
  type MatchPredictionRow,
  type MatchPredictionsQuery,
} from "@/lib/api/admin";
import type { MatchStatus, OutcomeType } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

/**
 * Sección de auditoría de predicciones para `/admin/partidos/[id]`.
 *
 * Fuentes de verdad:
 *   - Filtros (outcome, sort, search) viven en useState locales — el
 *     componente no toca la URL para no acoplar a Next.js router en
 *     un sub-componente. La página padre puede levantarlo a la URL
 *     si lo necesita.
 *   - Polling 30s alineado al cadencia del leaderboard público.
 *   - Stats se computan sobre el match entero (independiente del filtro);
 *     el endpoint backend ya las separa.
 */
const SORT_LABELS: Record<NonNullable<MatchPredictionsQuery["sort"]>, string> = {
  points_desc: "Puntos ↓",
  points_asc: "Puntos ↑",
  name_asc: "Apellido A → Z",
  name_desc: "Apellido Z → A",
  prediction: "Por pronóstico",
};

const OUTCOME_LABELS: Record<OutcomeType | "PENDING", string> = {
  EXACT: "Exactos",
  WINNER_AND_DIFF: "Ganador + diff",
  DRAW_DIFFERENT: "Empate (otro)",
  WINNER_ONLY: "Solo ganador",
  MISS: "Errados",
  PENDING: "Sin evaluar",
};

// Mapa color-por-outcome. Reusa los tokens de la paleta editorial.
const OUTCOME_COLORS: Record<
  OutcomeType | "PENDING",
  { dot: string; pill: string }
> = {
  EXACT: {
    dot: "bg-[var(--color-landing-green)]",
    pill: "border-[var(--color-landing-green)] text-[var(--color-landing-green)]",
  },
  WINNER_AND_DIFF: {
    dot: "bg-[var(--color-landing-gold)]",
    pill: "border-[var(--color-landing-gold)] text-[var(--color-landing-gold)]",
  },
  DRAW_DIFFERENT: {
    dot: "bg-[var(--color-landing-gold)]",
    pill: "border-[var(--color-landing-gold)] text-[var(--color-landing-gold)]",
  },
  WINNER_ONLY: {
    dot: "bg-orange-500",
    pill: "border-orange-500 text-orange-500",
  },
  MISS: {
    dot: "bg-[var(--color-landing-red)]",
    pill: "border-[var(--color-landing-red)] text-[var(--color-landing-red)]",
  },
  PENDING: {
    dot: "bg-[var(--color-landing-text-muted)]",
    pill: "border-[var(--color-landing-line-strong)] text-[var(--color-landing-text-muted)]",
  },
};

interface Props {
  matchId: string;
  matchStatus: MatchStatus;
  matchScoreHome: number | null;
  matchScoreAway: number | null;
}

export function MatchPredictionsSection({
  matchId,
  matchStatus,
  matchScoreHome,
  matchScoreAway,
}: Props) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<NonNullable<MatchPredictionsQuery["sort"]>>(
    "points_desc",
  );
  const [outcome, setOutcome] = useState<MatchPredictionsQuery["outcome"]>();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce 300ms para no spamear el endpoint con cada keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      // El backend valida ≥0 chars y filtra ILIKE; lo enviamos solo si
      // el user escribió ≥2 chars para evitar listas casi completas.
      setDebouncedSearch(trimmed.length >= 2 ? trimmed : "");
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // Reset de página al cambiar cualquier filtro — sino el admin queda
  // mirando una página fantasma sin resultados.
  useEffect(() => {
    setPage(1);
  }, [sort, outcome, debouncedSearch]);

  const filters: MatchPredictionsQuery = useMemo(
    () => ({
      page,
      pageSize: 50,
      sort,
      outcome: outcome || undefined,
      search: debouncedSearch || undefined,
    }),
    [page, sort, outcome, debouncedSearch],
  );

  const predictionsQuery = useQuery({
    queryKey: queryKeys.admin.matches.predictions(
      matchId,
      filters as unknown as Record<string, unknown>,
    ),
    queryFn: () => getMatchPredictions(matchId, filters),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const stats = predictionsQuery.data?.stats;
  const rows = predictionsQuery.data?.data ?? [];
  const total = predictionsQuery.data?.total ?? 0;
  const pageSize = predictionsQuery.data?.pageSize ?? 50;
  const isFinished = matchStatus === "FINISHED";
  const showOrdinal = sort === "points_desc";
  const startOrdinal = (page - 1) * pageSize;

  const columns: ColumnDef<MatchPredictionRow, unknown>[] = useMemo(() => {
    const base: ColumnDef<MatchPredictionRow, unknown>[] = [];
    if (showOrdinal) {
      base.push({
        id: "ordinal",
        header: "#",
        cell: ({ row }) => (
          <span className="font-[family-name:var(--font-landing-mono)] text-xs tabular-nums text-[var(--color-landing-text-muted)]">
            {startOrdinal + row.index + 1}
          </span>
        ),
      });
    }
    base.push(
      {
        id: "user",
        header: "Usuario",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-sans text-sm text-[var(--color-landing-text)]">
                  {r.userFirstName} {r.userLastName}
                </span>
                {r.entryAlias ? (
                  <span className="rounded-sm border border-[var(--color-landing-line-strong)] px-1.5 py-0.5 font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
                    {r.entryAlias}
                  </span>
                ) : null}
              </div>
              <div className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--color-landing-text-muted)]">
                DNI {r.userDni}
              </div>
            </div>
          );
        },
      },
      {
        id: "prediction",
        header: "Pronóstico",
        cell: ({ row }) => {
          const r = row.original;
          const exactHit =
            isFinished &&
            matchScoreHome !== null &&
            matchScoreAway !== null &&
            r.scoreHome === matchScoreHome &&
            r.scoreAway === matchScoreAway;
          return (
            <div className="flex items-center gap-2">
              <span className="font-[family-name:var(--font-landing-mono)] text-base font-bold tabular-nums text-[var(--color-landing-text)]">
                {r.scoreHome} - {r.scoreAway}
              </span>
              {isFinished ? (
                exactHit ? (
                  <Check
                    className="h-3 w-3 text-[var(--color-landing-green)]"
                    aria-label="Acierto exacto"
                  />
                ) : null
              ) : null}
            </div>
          );
        },
      },
      {
        id: "outcome",
        header: "Resultado",
        cell: ({ row }) => {
          const key: OutcomeType | "PENDING" =
            row.original.outcomeType ?? "PENDING";
          const colors = OUTCOME_COLORS[key];
          return (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em]",
                colors.pill,
              )}
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full", colors.dot)}
                aria-hidden
              />
              {OUTCOME_LABELS[key]}
            </span>
          );
        },
      },
      {
        id: "points",
        header: "Puntos",
        cell: ({ row }) => {
          const r = row.original;
          if (r.outcomeType === null) {
            return (
              <span className="font-[family-name:var(--font-landing-mono)] text-sm text-[var(--color-landing-text-muted)]">
                —
              </span>
            );
          }
          return (
            <span
              className="font-[family-name:var(--font-landing-mono)] text-sm font-bold tabular-nums text-[var(--color-landing-text)]"
              title={`${r.basePoints} × ${r.multiplier}`}
            >
              {r.pointsEarned}
            </span>
          );
        },
      },
      {
        id: "updatedAt",
        header: "Cargada",
        cell: ({ row }) => (
          <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--color-landing-text-muted)]">
            {formatShortDateTime(row.original.updatedAt)}
          </span>
        ),
      },
    );
    return base;
  }, [
    isFinished,
    matchScoreHome,
    matchScoreAway,
    showOrdinal,
    startOrdinal,
  ]);

  const chips: Array<{
    key: OutcomeType | "PENDING";
    count: number;
  }> = [
    { key: "EXACT", count: stats?.exactCount ?? 0 },
    { key: "WINNER_AND_DIFF", count: stats?.winnerAndDiffCount ?? 0 },
    { key: "DRAW_DIFFERENT", count: stats?.drawDifferentCount ?? 0 },
    { key: "WINNER_ONLY", count: stats?.winnerOnlyCount ?? 0 },
    { key: "MISS", count: stats?.missCount ?? 0 },
  ];
  const pendingCount =
    (stats?.totalPredictions ?? 0) - (stats?.evaluatedCount ?? 0);
  if (pendingCount > 0) {
    chips.push({ key: "PENDING", count: pendingCount });
  }

  const banner = useMemo(() => {
    switch (matchStatus) {
      case "LOCKED":
        return {
          tone: "neutral" as const,
          text: "Predicciones cerradas, esperando inicio.",
        };
      case "CANCELLED":
        return {
          tone: "warning" as const,
          text: "Este partido fue cancelado. Las predicciones no suman puntos.",
        };
      case "POSTPONED":
        return {
          tone: "warning" as const,
          text: "Este partido fue postergado. Cuando se finalice se evaluarán.",
        };
      default:
        return null;
    }
  }, [matchStatus]);

  return (
    <section className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
            Predicciones
          </h2>
          <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
            {stats ? (
              <>
                {stats.totalPredictions} pronósticos ·{" "}
                {stats.evaluatedCount} evaluados ·{" "}
                {stats.pointsDistributed} pts repartidos
              </>
            ) : (
              <>Cargando stats…</>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => predictionsQuery.refetch()}
          aria-label="Refrescar predicciones"
          className="shrink-0 inline-flex items-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-3 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
        >
          <span
            role="status"
            aria-label={
              predictionsQuery.isFetching ? "Refrescando" : "Actualizado"
            }
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              predictionsQuery.isFetching
                ? "bg-[var(--color-landing-red)] landing-pulse"
                : "bg-[var(--color-landing-text-muted)]",
            )}
          />
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              predictionsQuery.isFetching && "animate-spin",
            )}
            aria-hidden
          />
          Refrescar
        </button>
      </div>

      {banner ? (
        <div
          className={cn(
            "mt-4 rounded-sm border px-3 py-2 font-sans text-xs",
            banner.tone === "warning"
              ? "border-[var(--color-landing-red)] text-[var(--color-landing-red)]"
              : "border-[var(--color-landing-line-strong)] text-[var(--color-landing-text-muted)]",
          )}
        >
          {banner.text}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map(({ key, count }) => {
          const active = outcome === key;
          const colors = OUTCOME_COLORS[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setOutcome(active ? undefined : key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-sm border px-2.5 py-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
                active
                  ? cn(colors.pill, "bg-[var(--color-landing-surface-2)]")
                  : "border-[var(--color-landing-line-strong)] text-[var(--color-landing-text-muted)] hover:border-[var(--color-landing-text)] hover:text-[var(--color-landing-text)]",
              )}
              aria-pressed={active}
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full", colors.dot)}
                aria-hidden
              />
              {OUTCOME_LABELS[key]}
              <span className="tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-xs">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-landing-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por nombre o DNI…"
            className="h-9 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] pl-9 pr-9 font-sans text-sm text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
            aria-label="Buscar predicciones por nombre o DNI"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <label className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
            Orden
            <select
              value={sort}
              onChange={(e) =>
                setSort(
                  e.target.value as NonNullable<MatchPredictionsQuery["sort"]>,
                )
              }
              className="ml-2 h-8 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-2 font-sans text-xs text-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
            >
              {(
                Object.keys(SORT_LABELS) as Array<
                  NonNullable<MatchPredictionsQuery["sort"]>
                >
              ).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-4">
        <AdminDataTable<MatchPredictionRow>
          data={rows}
          columns={columns}
          loading={predictionsQuery.isLoading}
          emptyMessage={
            debouncedSearch || outcome
              ? "Sin resultados para los filtros aplicados."
              : "Aún nadie cargó predicción para este partido."
          }
          ariaLabel="Predicciones del partido"
        />
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
      />
    </section>
  );
}

const SHORT_DATETIME = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return SHORT_DATETIME.format(d);
}

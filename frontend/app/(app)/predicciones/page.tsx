"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { HTTPError } from "ky";
import { toast } from "sonner";
import { PhaseTabs, type PhaseTabValue } from "@/components/domain/phase-tabs";
import { MatchCard } from "@/components/domain/match-card";

// Lazy-load the number pad sheet — only mounted once the user taps a match
// score on mobile, so we keep it out of the initial /predicciones bundle.
const NumberPadSheet = dynamic(
  () =>
    import("@/components/domain/number-pad-sheet").then((m) => m.NumberPadSheet),
);
import { queryKeys } from "@/lib/api/queryKeys";
import {
  getMatches,
  getMatchesByPhase,
  getUpcomingMatches,
} from "@/lib/api/matches";
import {
  getEntryPredictions,
  upsertMatchPrediction,
} from "@/lib/api/predictions";
import type { Match, Paginated, Prediction } from "@/lib/api/types";
import { useActiveEntry } from "@/lib/hooks/use-active-entry";
import { deriveAvailablePhases } from "@/lib/landing/available-phases";

type MatchListData = Match[];

export default function PrediccionesPage() {
  const [tab, setTab] = useState<PhaseTabValue>("UPCOMING");
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const { activeEntry } = useActiveEntry();
  const entryId = activeEntry?.id ?? "";

  // All matches (cache lago) → derivar fases visibles para los tabs.
  const allMatchesQuery = useQuery<MatchListData>({
    queryKey: queryKeys.matches.list(),
    queryFn: () => getMatches({ pageSize: 200 }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const availablePhases = deriveAvailablePhases(allMatchesQuery.data);

  const matchesQuery = useQuery<MatchListData>({
    queryKey:
      tab === "UPCOMING"
        ? queryKeys.matches.upcoming()
        : queryKeys.matches.byPhase(tab),
    queryFn: async () =>
      tab === "UPCOMING"
        ? await getUpcomingMatches({ limit: 30 })
        : await getMatchesByPhase(tab),
    staleTime: 30_000,
  });

  // Get all my predictions del entry activo. Backend pagina; en el
  // peor caso son ~64 partidos × 1 prediction por entry. pageSize=200
  // cubre todo. `enabled` evita pegar al backend antes de que
  // ActiveEntryProvider resuelva el activeEntry.
  const predictionsQuery = useQuery<Paginated<Prediction>>({
    queryKey: queryKeys.entries.predictions(entryId, { pageSize: 200 }),
    queryFn: () => getEntryPredictions(entryId, { pageSize: 200 }),
    enabled: !!entryId,
    staleTime: 30_000,
  });

  // Map matchId → prediction para lookup O(1).
  const predictionsByMatch = useMemo(() => {
    const map = new Map<string, Prediction>();
    for (const p of predictionsQuery.data?.data ?? []) {
      map.set(p.matchId, p);
    }
    return map;
  }, [predictionsQuery.data]);

  const queryClient = useQueryClient();

  // Auto-save mutation con optimistic update (spec §8.4). El `entryId`
  // se snapshotea al disparar la mutation: si el user cambia de entry
  // mid-mutation, esta sigue apuntando al entry original (spec §5.5).
  const upsertMutation = useMutation({
    mutationFn: async ({
      entryId: mutationEntryId,
      matchId,
      dto,
    }: {
      entryId: string;
      matchId: string;
      dto: { scoreHome: number; scoreAway: number };
    }) => upsertMatchPrediction(mutationEntryId, matchId, dto),
    onMutate: async ({ entryId: mutationEntryId, matchId, dto }) => {
      const cacheKey = queryKeys.entries.predictions(mutationEntryId, {
        pageSize: 200,
      });
      // Cancel ongoing refetches that could overwrite our optimistic write.
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const prev = queryClient.getQueryData<Paginated<Prediction>>(cacheKey);
      if (prev) {
        const data = [...prev.data];
        const idx = data.findIndex((p) => p.matchId === matchId);
        const optimistic: Prediction = {
          id: idx >= 0 ? data[idx]!.id : `optimistic-${matchId}`,
          entryId: mutationEntryId,
          userId: idx >= 0 ? data[idx]!.userId : undefined,
          matchId,
          scoreHome: dto.scoreHome,
          scoreAway: dto.scoreAway,
          outcomeType: null,
          basePoints: 0,
          multiplier: 1,
          pointsEarned: 0,
          evaluatedAt: null,
          createdAt:
            idx >= 0 ? data[idx]!.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (idx >= 0) data[idx] = optimistic;
        else data.push(optimistic);
        queryClient.setQueryData<Paginated<Prediction>>(cacheKey, {
          ...prev,
          data,
        });
      }
      return { prev, cacheKey };
    },
    onError: async (err, _vars, ctx) => {
      // Rollback to pre-mutation snapshot.
      if (ctx?.prev && ctx.cacheKey) {
        queryClient.setQueryData(ctx.cacheKey, ctx.prev);
      }
      // Caso reactivo: el backend rechazó porque las predicciones cerraron
      // mientras el user tenía la página vieja abierta. Mensaje específico
      // + invalidate para que la card flipee a "cerrado".
      if (err instanceof HTTPError) {
        try {
          const body = (await err.response.clone().json()) as {
            code?: string;
          };
          if (body.code === "PREDICTION_LOCKED") {
            toast.error("Las predicciones para este partido ya cerraron.");
            queryClient.invalidateQueries({
              queryKey: queryKeys.matches.all(),
            });
            return;
          }
        } catch {
          // body no era JSON o falló parse — caemos al toast genérico.
        }
      }
      toast.error("No pudimos guardar tu prediccion. Reintenta en un momento.");
    },
    onSettled: () => {
      // Invalida ambos namespaces — el legacy cubre cualquier consumer
      // todavía no migrado; entries.* cubre el cache real.
      queryClient.invalidateQueries({ queryKey: queryKeys.predictions.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.entries.all() });
    },
  });

  const handlePredict = (
    matchId: string,
    dto: { scoreHome: number; scoreAway: number },
  ) => {
    if (!entryId) return;
    upsertMutation.mutate({ entryId, matchId, dto });
  };

  // Caso proactivo: programar un invalidate exactamente cuando el partido
  // más próximo se cierra (lockAt + 1s). Cuando ese timer dispare, el query
  // se refrescará, las cards mostrarán "CERRADO" y el efecto se re-ejecuta
  // para programar el siguiente. Cubre el gap entre lockAt real y el cron
  // backend (60s) + el staleTime del front (30s).
  const earliestLockAt = useMemo(() => {
    const matches = matchesQuery.data ?? [];
    let earliest: number | null = null;
    for (const m of matches) {
      if (m.status !== "SCHEDULED") continue;
      const t = new Date(m.predictionsLockAt).getTime();
      if (t > Date.now() && (earliest === null || t < earliest)) {
        earliest = t;
      }
    }
    return earliest;
  }, [matchesQuery.data]);
  useEffect(() => {
    if (earliestLockAt === null) return;
    const delay = earliestLockAt - Date.now() + 1000;
    if (delay <= 0) return;
    const id = window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.matches.all() });
    }, delay);
    return () => window.clearTimeout(id);
  }, [earliestLockAt, queryClient]);

  // Active match for the shared NumberPadSheet (mobile).
  const activeMatch =
    activeMatchId && matchesQuery.data
      ? matchesQuery.data.find((m) => m.id === activeMatchId)
      : null;
  const activePrediction = activeMatchId
    ? predictionsByMatch.get(activeMatchId)
    : undefined;

  // Stats para el masthead — solo cuentan matches OPEN (no locked /
  // finished) en el tab activo. "Cargados" es la cantidad con
  // prediction asociada del entry activo.
  const openMatches = (matchesQuery.data ?? []).filter(
    (m) => m.status === "SCHEDULED",
  );
  const openTotal = openMatches.length;
  const openLoaded = openMatches.filter((m) => predictionsByMatch.has(m.id))
    .length;

  return (
    <>
      <PhaseTabs
        value={tab}
        onChange={setTab}
        availablePhases={availablePhases}
      />

      <section className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">
        <h1 className="sr-only">Mis predicciones</h1>

        <Masthead tab={tab} openTotal={openTotal} openLoaded={openLoaded} />

        {matchesQuery.isLoading || predictionsQuery.isLoading ? (
          <SkeletonList />
        ) : matchesQuery.isError ? (
          <ErrorBlock
            onRetry={() => {
              matchesQuery.refetch();
              predictionsQuery.refetch();
            }}
          />
        ) : !matchesQuery.data || matchesQuery.data.length === 0 ? (
          <EmptyBlock tab={tab} />
        ) : (
          <GroupedMatchList
            matches={matchesQuery.data}
            predictionsByMatch={predictionsByMatch}
            pendingMatchId={
              upsertMutation.isPending ? upsertMutation.variables?.matchId ?? null : null
            }
            erroredMatchId={
              upsertMutation.isError ? upsertMutation.variables?.matchId ?? null : null
            }
            onOpenSheet={(matchId) => setActiveMatchId(matchId)}
            onPredict={handlePredict}
          />
        )}
      </section>

      {activeMatch ? (
        <NumberPadSheet
          open={activeMatchId !== null}
          onOpenChange={(open) => {
            if (!open) setActiveMatchId(null);
          }}
          homeTeam={{
            name: activeMatch.homeTeam?.name ?? activeMatch.homeTeamLabel ?? "—",
            fifaCode: activeMatch.homeTeam?.fifaCode,
            flagUrl: activeMatch.homeTeam?.flagUrl,
          }}
          awayTeam={{
            name: activeMatch.awayTeam?.name ?? activeMatch.awayTeamLabel ?? "—",
            fifaCode: activeMatch.awayTeam?.fifaCode,
            flagUrl: activeMatch.awayTeam?.flagUrl,
          }}
          initialScoreHome={activePrediction?.scoreHome ?? null}
          initialScoreAway={activePrediction?.scoreAway ?? null}
          onSave={(dto) => {
            handlePredict(activeMatch.id, dto);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Masthead "newspaper" del listado — eyebrow + título Anton 56px +
 * subline + bloque de stats a la derecha (X/Y cargados). Cierra con
 * border-top text + border-bottom line. Es la entrada al fixture.
 */
function Masthead({
  tab,
  openTotal,
  openLoaded,
}: {
  tab: PhaseTabValue;
  openTotal: number;
  openLoaded: number;
}) {
  const titleByTab: Record<PhaseTabValue, [string, string]> = {
    UPCOMING: ["FIXTURE", "ABIERTO"],
    GROUPS: ["FASE DE", "GRUPOS"],
    ROUND_32: ["DIECISEIS", "AVOS"],
    ROUND_16: ["OCTAVOS", "DE FINAL"],
    QUARTERS: ["CUARTOS", "DE FINAL"],
    SEMIS: ["SEMI", "FINALES"],
    THIRD_PLACE: ["TERCER", "PUESTO"],
    FINAL: ["LA", "FINAL"],
  };
  const [line1, line2] = titleByTab[tab] ?? ["FIXTURE", "ABIERTO"];

  const pendientes = Math.max(0, openTotal - openLoaded);
  const subline =
    openTotal === 0
      ? "SIN PARTIDOS ABIERTOS"
      : `${openTotal} ${openTotal === 1 ? "PARTIDO" : "PARTIDOS"} ABIERTOS`;

  return (
    <header className="border-t-[4px] border-t-[var(--color-landing-text)] border-b border-b-[var(--color-landing-line)] mb-8 flex items-end justify-between gap-4 pt-5 pb-4">
      <div className="min-w-0">
        <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)] mb-2">
          Mis predicciones
        </div>
        <h2 className="font-[family-name:var(--font-landing-display)] text-[44px] md:text-[56px] uppercase leading-[0.9] tracking-[-0.005em] text-[var(--color-landing-text)] m-0">
          {line1}
          <br />
          {line2}
        </h2>
        <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] mt-2">
          {subline}
        </div>
      </div>
      {openTotal > 0 ? (
        <div className="text-right font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)] leading-[1.6] flex-shrink-0">
          <span className="block font-[family-name:var(--font-landing-display)] text-[32px] md:text-[36px] leading-none mb-1 text-[var(--color-landing-gold)] tabular-nums">
            {openLoaded}/{openTotal}
          </span>
          Cargados
          <br />
          <span className="text-[var(--color-landing-text-muted)]">
            {pendientes} {pendientes === 1 ? "pendiente" : "pendientes"}
          </span>
        </div>
      ) : null}
    </header>
  );
}

function GroupedMatchList({
  matches,
  predictionsByMatch,
  pendingMatchId,
  erroredMatchId,
  onOpenSheet,
  onPredict,
}: {
  matches: Match[];
  predictionsByMatch: Map<string, Prediction>;
  pendingMatchId: string | null;
  erroredMatchId: string | null;
  onOpenSheet: (matchId: string) => void;
  onPredict: (
    matchId: string,
    dto: { scoreHome: number; scoreAway: number },
  ) => void;
}) {
  // Sort por kickoffAt ascending; agrupamos en la TZ del navegador
  // (kickoffAt llega en UTC). Un partido a las 23:00 ART aparece bajo
  // el día calendario que le corresponde al usuario, no al día ART.
  const sorted = [...matches].sort(
    (a, b) =>
      new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
  );
  // Agrupa con un key estable basado en yyyy-mm-dd local, separado del
  // texto formateado para que el render de los headers no dependa del
  // locale (titlecase / espacios) — solo del día.
  const groups = new Map<string, { day: Date; matches: Match[] }>();
  for (const m of sorted) {
    const d = new Date(m.kickoffAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const existing = groups.get(key);
    if (existing) {
      existing.matches.push(m);
    } else {
      groups.set(key, { day: d, matches: [m] });
    }
  }

  const entries = [...groups.entries()];

  return (
    <div className="flex flex-col gap-10">
      {entries.map(([key, { day, matches: list }]) => (
        <section key={key} className="flex flex-col gap-4">
          <DayHeader day={day} count={list.length} />
          <div className="flex flex-col gap-3">
            {list.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                prediction={predictionsByMatch.get(m.id) ?? null}
                onOpenSheet={onOpenSheet}
                onPredict={onPredict}
                loading={pendingMatchId === m.id}
                error={erroredMatchId === m.id}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Header gigante por día — patrón editorial del landing: weekday
 * abreviado + número en gold (Anton) + mes abreviado, con border-bottom
 * line-strong y meta a la derecha (cantidad de partidos).
 */
function DayHeader({ day, count }: { day: Date; count: number }) {
  // Ej: "SÁB 13 JUN" — usamos formatToParts para poder darle color
  // distinto al número del día (el "13" en gold).
  const fmt = new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const parts = fmt.formatToParts(day);
  const weekday =
    parts.find((p) => p.type === "weekday")?.value.replace(".", "") ?? "";
  const dayNum = parts.find((p) => p.type === "day")?.value ?? "";
  const month =
    parts.find((p) => p.type === "month")?.value.replace(".", "") ?? "";

  return (
    <div className="flex items-baseline gap-3 md:gap-4 border-b border-[var(--color-landing-line-strong)] pb-2">
      <h2 className="font-[family-name:var(--font-landing-display)] text-[44px] md:text-[64px] uppercase leading-[0.9] tracking-[-0.01em] text-[var(--color-landing-text)] m-0">
        {weekday.toUpperCase()}{" "}
        <span className="text-[var(--color-landing-gold)]">{dayNum}</span>{" "}
        {month.toUpperCase()}
      </h2>
      <span className="ml-auto text-right font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)] leading-[1.4]">
        {count} {count === 1 ? "PARTIDO" : "PARTIDOS"}
      </span>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="h-32 rounded-sm bg-[var(--color-landing-surface)] border border-[var(--color-landing-line)] animate-pulse"
        />
      ))}
    </div>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-6 text-center">
      <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
        No pudimos cargar los partidos.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center justify-center font-[family-name:var(--font-landing-mono)] text-[11px] font-extrabold uppercase tracking-[0.18em] text-[var(--color-landing-text)] underline underline-offset-4 decoration-[var(--color-landing-green)] decoration-2 hover:text-[var(--color-landing-gold)]"
      >
        Reintentar
      </button>
    </div>
  );
}

function EmptyBlock({ tab }: { tab: PhaseTabValue }) {
  return (
    <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-10 text-center">
      <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        Sin partidos
      </p>
      <p className="mt-3 font-[family-name:var(--font-landing-display)] text-[28px] uppercase tracking-[0.02em] leading-tight text-[var(--color-landing-text)]">
        {tab === "UPCOMING"
          ? "No hay partidos proximos por ahora."
          : "Esta fase aun no tiene partidos cargados."}
      </p>
    </div>
  );
}

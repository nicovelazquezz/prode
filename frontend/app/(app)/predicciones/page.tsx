"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
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
    onError: (_err, _vars, ctx) => {
      // Rollback to pre-mutation snapshot.
      if (ctx?.prev && ctx.cacheKey) {
        queryClient.setQueryData(ctx.cacheKey, ctx.prev);
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

  // Active match for the shared NumberPadSheet (mobile).
  const activeMatch =
    activeMatchId && matchesQuery.data
      ? matchesQuery.data.find((m) => m.id === activeMatchId)
      : null;
  const activePrediction = activeMatchId
    ? predictionsByMatch.get(activeMatchId)
    : undefined;

  return (
    <>
      <PhaseTabs
        value={tab}
        onChange={setTab}
        availablePhases={availablePhases}
      />

      <section className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-10">
        <h1 className="sr-only">Mis predicciones</h1>

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
  // Agrupar por día en la TZ del navegador del usuario. kickoffAt llega
  // en UTC; un partido a las 23:00 ART (= 02:00 UTC del día siguiente)
  // aparece bajo el día calendario que le corresponde al usuario donde
  // está parado, no al día ART.
  const dayFormatter = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const groups = new Map<string, Match[]>();
  // Sort by kickoffAt ascending, then group.
  const sorted = [...matches].sort(
    (a, b) =>
      new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
  );
  for (const m of sorted) {
    const key = dayFormatter.format(new Date(m.kickoffAt));
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  const entries = [...groups.entries()];

  return (
    <div className="flex flex-col gap-8">
      {entries.map(([day, list]) => (
        <div key={day} className="flex flex-col gap-4">
          <h2 className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
            {day}
          </h2>
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
        </div>
      ))}
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

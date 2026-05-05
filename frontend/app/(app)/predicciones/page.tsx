"use client";

import { useMemo, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { PhaseTabs, type PhaseTabValue } from "@/components/domain/phase-tabs";
import { MatchCard } from "@/components/domain/match-card";
import { NumberPadSheet } from "@/components/domain/number-pad-sheet";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  getMatchesByPhase,
  getUpcomingMatches,
} from "@/lib/api/matches";
import {
  getMyPredictions,
  upsertMatchPrediction,
} from "@/lib/api/predictions";
import type { Match, Paginated, Prediction } from "@/lib/api/types";

type MatchListData = Match[];

export default function PrediccionesPage() {
  const [tab, setTab] = useState<PhaseTabValue>("UPCOMING");
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);

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

  // Get all my predictions in one shot. Backend pagina; en el peor
  // caso son ~64 partidos × 1 prediction. pageSize=200 cubre todo.
  const predictionsQuery = useQuery<Paginated<Prediction>>({
    queryKey: queryKeys.predictions.me({ pageSize: 200 }),
    queryFn: () => getMyPredictions({ pageSize: 200 }),
    staleTime: 30_000,
  });

  // Map matchId → prediction para lookup O(1).
  const predictionsByMatch = useMemo(() => {
    const map = new Map<string, Prediction>();
    for (const p of predictionsQuery.data?.items ?? []) {
      map.set(p.matchId, p);
    }
    return map;
  }, [predictionsQuery.data]);

  const queryClient = useQueryClient();

  // Auto-save mutation con optimistic update (spec §8.4).
  const upsertMutation = useMutation({
    mutationFn: async ({
      matchId,
      dto,
    }: {
      matchId: string;
      dto: { scoreHome: number; scoreAway: number };
    }) => upsertMatchPrediction(matchId, dto),
    onMutate: async ({ matchId, dto }) => {
      // Cancel ongoing refetches that could overwrite our optimistic write.
      await queryClient.cancelQueries({
        queryKey: queryKeys.predictions.me({ pageSize: 200 }),
      });
      const prev = queryClient.getQueryData<Paginated<Prediction>>(
        queryKeys.predictions.me({ pageSize: 200 }),
      );
      if (prev) {
        const items = [...prev.items];
        const idx = items.findIndex((p) => p.matchId === matchId);
        const optimistic: Prediction = {
          id: idx >= 0 ? items[idx]!.id : `optimistic-${matchId}`,
          userId: idx >= 0 ? items[idx]!.userId : "me",
          matchId,
          scoreHome: dto.scoreHome,
          scoreAway: dto.scoreAway,
          outcomeType: null,
          basePoints: 0,
          multiplier: 1,
          pointsEarned: 0,
          evaluatedAt: null,
          createdAt:
            idx >= 0 ? items[idx]!.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (idx >= 0) items[idx] = optimistic;
        else items.push(optimistic);
        queryClient.setQueryData<Paginated<Prediction>>(
          queryKeys.predictions.me({ pageSize: 200 }),
          { ...prev, items },
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      // Rollback to pre-mutation snapshot.
      if (ctx?.prev) {
        queryClient.setQueryData(
          queryKeys.predictions.me({ pageSize: 200 }),
          ctx.prev,
        );
      }
      toast.error("No pudimos guardar tu prediccion. Reintenta en un momento.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.predictions.all(),
      });
    },
  });

  const handlePredict = (
    matchId: string,
    dto: { scoreHome: number; scoreAway: number },
  ) => {
    upsertMutation.mutate({ matchId, dto });
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
      <PhaseTabs value={tab} onChange={setTab} />

      <section className="mx-auto max-w-2xl px-4 py-6 md:px-8">
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
          }}
          awayTeam={{
            name: activeMatch.awayTeam?.name ?? activeMatch.awayTeamLabel ?? "—",
            fifaCode: activeMatch.awayTeam?.fifaCode,
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
  // Group by day (kickoff date in ART timezone).
  const dayFormatter = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Argentina/Buenos_Aires",
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
    <div className="flex flex-col gap-6">
      {entries.map(([day, list]) => (
        <div key={day} className="flex flex-col gap-3">
          <h2 className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
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
          className="h-32 rounded-md bg-[var(--color-prode-surface)] animate-pulse"
        />
      ))}
    </div>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-md border border-[var(--color-prode-border)] bg-white p-6 text-center">
      <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
        No pudimos cargar los partidos.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center justify-center font-sans text-sm font-bold uppercase tracking-wider text-[var(--color-prode-near-black)] underline underline-offset-4"
      >
        Reintentar
      </button>
    </div>
  );
}

function EmptyBlock({ tab }: { tab: PhaseTabValue }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--color-prode-border)] bg-white p-8 text-center">
      <p className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
        Sin partidos
      </p>
      <p className="mt-2 font-sans text-sm text-[var(--color-prode-text-secondary)]">
        {tab === "UPCOMING"
          ? "No hay partidos proximos por ahora."
          : "Esta fase aun no tiene partidos cargados."}
      </p>
    </div>
  );
}

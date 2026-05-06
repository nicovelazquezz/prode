"use client";

import { use, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Lock } from "lucide-react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { TeamFlag } from "@/components/domain/team-flag";
import { ScoreDisplay } from "@/components/domain/score-display";
import { PredictionInput } from "@/components/domain/prediction-input";

// Lazy-load the number pad sheet — only needed when the user taps an input
// on mobile.
const NumberPadSheet = dynamic(
  () =>
    import("@/components/domain/number-pad-sheet").then((m) => m.NumberPadSheet),
);
import { CountdownTimer } from "@/components/domain/countdown-timer";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  getMatchByIdPublic,
  getMatchPredictionCount,
} from "@/lib/api/matches";
import {
  getEntryPredictionForMatch,
  upsertMatchPrediction,
} from "@/lib/api/predictions";
import { useActiveEntry } from "@/lib/hooks/use-active-entry";
import type { Match, Prediction } from "@/lib/api/types";

const PHASE_LABELS: Record<string, string> = {
  GROUPS: "Grupos",
  ROUND_32: "16avos",
  ROUND_16: "Octavos",
  QUARTERS: "Cuartos",
  SEMIS: "Semis",
  THIRD_PLACE: "3er puesto",
  FINAL: "Final",
};

const OUTCOME_LABELS: Record<string, string> = {
  EXACT: "Resultado exacto",
  WINNER_AND_DIFF: "Ganador + diferencia",
  DRAW_DIFFERENT: "Empate (distinto resultado)",
  WINNER_ONLY: "Solo ganador",
  MISS: "Errado",
};

interface PageProps {
  params: Promise<{ matchId: string }>;
}

export default function MatchDetailPage({ params }: PageProps) {
  const { matchId } = use(params);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { activeEntry } = useActiveEntry();
  const entryId = activeEntry?.id ?? "";

  const matchQuery = useQuery<Match | null>({
    queryKey: queryKeys.matches.detail(matchId),
    queryFn: () => getMatchByIdPublic(matchId),
    staleTime: 60_000,
  });

  const predictionQuery = useQuery<Prediction | null>({
    queryKey: queryKeys.entries.predictionForMatch(entryId, matchId),
    queryFn: () => getEntryPredictionForMatch(entryId, matchId),
    enabled: !!entryId,
    staleTime: 30_000,
  });

  const countQuery = useQuery({
    queryKey: queryKeys.matches.predictionCount(matchId),
    queryFn: () => getMatchPredictionCount(matchId),
    staleTime: 60_000,
  });

  const queryClient = useQueryClient();

  const upsertMutation = useMutation({
    mutationFn: (dto: { scoreHome: number; scoreAway: number }) =>
      upsertMatchPrediction(entryId, matchId, dto),
    onMutate: async (dto) => {
      const cacheKey = queryKeys.entries.predictionForMatch(entryId, matchId);
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const prev = queryClient.getQueryData<Prediction | null>(cacheKey);
      const optimistic: Prediction = {
        id: prev?.id ?? `optimistic-${matchId}`,
        entryId,
        userId: prev?.userId,
        matchId,
        scoreHome: dto.scoreHome,
        scoreAway: dto.scoreAway,
        outcomeType: null,
        basePoints: 0,
        multiplier: 1,
        pointsEarned: 0,
        evaluatedAt: null,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueryData(cacheKey, optimistic);
      return { prev, cacheKey };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined && ctx.cacheKey) {
        queryClient.setQueryData(ctx.cacheKey, ctx.prev);
      }
      toast.error("No pudimos guardar tu prediccion. Reintenta.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.entries.all() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.predictions.all(),
      });
    },
  });

  if (matchQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">
        <div className="space-y-4" aria-busy="true">
          <div className="h-8 w-32 bg-[var(--color-landing-surface)] rounded-sm animate-pulse" />
          <div className="h-40 bg-[var(--color-landing-surface)] rounded-sm animate-pulse" />
          <div className="h-24 bg-[var(--color-landing-surface)] rounded-sm animate-pulse" />
        </div>
      </div>
    );
  }

  if (matchQuery.isError || !matchQuery.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">
        <BackLink />
        <div className="mt-6 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-6 text-center">
          <p className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
            Partido no encontrado
          </p>
          <p className="mt-2 font-sans text-sm text-[var(--color-landing-text-muted)]">
            Verifica que el link sea correcto o volve a la lista de partidos.
          </p>
        </div>
      </div>
    );
  }

  const match = matchQuery.data;
  const prediction = predictionQuery.data ?? null;

  const home = match.homeTeam;
  const away = match.awayTeam;
  const homeName = home?.name ?? match.homeTeamLabel ?? "Por definir";
  const awayName = away?.name ?? match.awayTeamLabel ?? "Por definir";
  const isLocked =
    match.status === "LOCKED" ||
    match.status === "IN_PROGRESS" ||
    match.status === "POSTPONED" ||
    match.status === "CANCELLED" ||
    new Date(match.predictionsLockAt).getTime() <= Date.now();
  const isFinished = match.status === "FINISHED";

  const inputDisabled = isLocked || isFinished;

  const handlePredict = (
    score: number,
    side: "home" | "away",
  ) => {
    const otherScore =
      side === "home"
        ? prediction?.scoreAway ?? null
        : prediction?.scoreHome ?? null;
    if (otherScore === null) {
      // Necesitamos ambos scores para enviar al backend; abrimos el
      // sheet para que el user complete el otro.
      setSheetOpen(true);
      return;
    }
    upsertMutation.mutate(
      side === "home"
        ? { scoreHome: score, scoreAway: otherScore }
        : { scoreHome: otherScore, scoreAway: score },
    );
  };

  return (
    <>
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 flex flex-col gap-6">
        <BackLink />

        {/* Hero compacto */}
        <header className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-6">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
              {match.groupCode
                ? `Grupo ${match.groupCode}`
                : PHASE_LABELS[match.phase] ?? match.phase}
            </span>
            {match.venue ? (
              <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
                · {match.venue}
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-3 items-center gap-4">
            <TeamPanel name={homeName} fifaCode={home?.fifaCode} flagUrl={home?.flagUrl} />
            <div className="flex flex-col items-center justify-center gap-1">
              {isFinished &&
              match.scoreHome !== null &&
              match.scoreAway !== null ? (
                <ScoreDisplay
                  scoreHome={match.scoreHome}
                  scoreAway={match.scoreAway}
                  size="lg"
                />
              ) : (
                <span className="font-[family-name:var(--font-landing-display)] text-3xl uppercase tracking-tight text-[var(--color-landing-text-muted)]">
                  vs
                </span>
              )}
              <KickoffMeta iso={match.kickoffAt} />
            </div>
            <TeamPanel name={awayName} fifaCode={away?.fifaCode} flagUrl={away?.flagUrl} />
          </div>
        </header>

        {/* Estado de cierre / countdown */}
        {!isFinished ? (
          <section className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-4">
            {isLocked ? (
              <div className="flex items-center gap-2 text-[var(--color-landing-text-muted)]">
                <Lock className="h-4 w-4" aria-hidden />
                <span className="font-sans text-sm font-bold uppercase tracking-wider">
                  Predicciones cerradas
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
                  Cierra en
                </span>
                <CountdownTimer
                  targetIso={match.predictionsLockAt}
                  compact
                  finishedLabel="Cerrado"
                />
              </div>
            )}
          </section>
        ) : null}

        {/* Tu prediccion */}
        <section className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-6">
          <h2 className="font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight text-[var(--color-landing-text)] mb-4">
            Tu prediccion
          </h2>
          <div className="flex items-center justify-between gap-4">
            <span className="font-sans text-sm text-[var(--color-landing-text-muted)] truncate">
              {homeName}
            </span>
            <PredictionInput
              value={prediction?.scoreHome ?? null}
              disabled={inputDisabled}
              onOpenSheet={() => setSheetOpen(true)}
              onChange={(s) => s !== null && handlePredict(s, "home")}
              ariaLabel={`Prediccion ${homeName}`}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-4">
            <span className="font-sans text-sm text-[var(--color-landing-text-muted)] truncate">
              {awayName}
            </span>
            <PredictionInput
              value={prediction?.scoreAway ?? null}
              disabled={inputDisabled}
              onOpenSheet={() => setSheetOpen(true)}
              onChange={(s) => s !== null && handlePredict(s, "away")}
              ariaLabel={`Prediccion ${awayName}`}
            />
          </div>

          {!inputDisabled ? (
            <div className="mt-4 md:hidden">
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => setSheetOpen(true)}
              >
                {prediction ? "Editar prediccion" : "Cargar prediccion"}
              </Button>
            </div>
          ) : null}
        </section>

        {/* Stats: cuantos predijeron */}
        {countQuery.data ? (
          <p className="font-sans text-sm text-[var(--color-landing-text-muted)] text-center">
            {countQuery.data.count} {countQuery.data.count === 1 ? "usuario predijo" : "usuarios predijeron"} este partido
          </p>
        ) : null}

        {/* Si finalizado: desglose de puntos */}
        {isFinished && prediction ? (
          <FinishedBreakdown match={match} prediction={prediction} />
        ) : null}
      </div>

      {/* NumberPadSheet compartido */}
      <NumberPadSheet
        open={sheetOpen && !inputDisabled}
        onOpenChange={setSheetOpen}
        homeTeam={{ name: homeName, fifaCode: home?.fifaCode, flagUrl: home?.flagUrl }}
        awayTeam={{ name: awayName, fifaCode: away?.fifaCode, flagUrl: away?.flagUrl }}
        initialScoreHome={prediction?.scoreHome ?? null}
        initialScoreAway={prediction?.scoreAway ?? null}
        onSave={(dto) => upsertMutation.mutate(dto)}
      />
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/predicciones"
      className="inline-flex items-center gap-2 font-sans text-sm font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Volver
    </Link>
  );
}

function TeamPanel({
  name,
  fifaCode,
  flagUrl,
}: {
  name: string;
  fifaCode?: string;
  flagUrl?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {fifaCode ? <TeamFlag fifaCode={fifaCode} src={flagUrl} size={64} /> : null}
      <span className="font-[family-name:var(--font-landing-display)] text-base md:text-lg uppercase tracking-tight text-[var(--color-landing-text)] line-clamp-2">
        {name}
      </span>
    </div>
  );
}

function KickoffMeta({ iso }: { iso: string }) {
  let formatted = "—";
  try {
    const d = new Date(iso);
    // Sin timeZone explícito → TZ del navegador del usuario.
    const fmt = new Intl.DateTimeFormat("es-AR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    formatted = fmt.format(d);
    const tzPart = new Intl.DateTimeFormat("es-AR", {
      timeZoneName: "short",
    })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value;
    if (tzPart) formatted = `${formatted} ${tzPart}`;
  } catch {}
  return (
    <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
      {formatted}
    </span>
  );
}

function FinishedBreakdown({
  match,
  prediction,
}: {
  match: Match;
  prediction: Prediction;
}) {
  const phase = PHASE_LABELS[match.phase] ?? match.phase;
  const outcome = prediction.outcomeType
    ? OUTCOME_LABELS[prediction.outcomeType] ?? prediction.outcomeType
    : "Sin evaluar";
  return (
    <section className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-6 border-l-[3px] [border-left-color:var(--color-landing-green)]">
      <h2 className="font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight text-[var(--color-landing-text)] mb-4">
        Resultado y puntos
      </h2>

      {match.scoreHome !== null && match.scoreAway !== null ? (
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
              Real
            </span>
            <ScoreDisplay
              scoreHome={match.scoreHome}
              scoreAway={match.scoreAway}
              size="md"
            />
          </div>
          <div className="flex flex-col gap-1 text-right">
            <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
              Tu prediccion
            </span>
            <ScoreDisplay
              scoreHome={prediction.scoreHome}
              scoreAway={prediction.scoreAway}
              size="md"
              isPrediction
            />
          </div>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <dt className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
          Tipo de acierto
        </dt>
        <dd className="font-sans font-medium text-[var(--color-landing-text)] text-right">
          {outcome}
        </dd>

        <dt className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
          Puntos base
        </dt>
        <dd className="font-sans font-medium text-[var(--color-landing-text)] text-right tabular-nums">
          {prediction.basePoints}
        </dd>

        <dt className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
          Multiplicador {phase}
        </dt>
        <dd className="font-sans font-medium text-[var(--color-landing-text)] text-right tabular-nums">
          x{prediction.multiplier}
        </dd>
      </dl>

      <div className="mt-4 pt-4 border-t border-[var(--color-landing-line-strong)] flex items-center justify-between">
        <span className="font-sans text-sm font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
          Total
        </span>
        <span
          className={
            "font-[family-name:var(--font-landing-display)] text-3xl tabular-nums leading-none " +
            (prediction.pointsEarned > 0
              ? "text-[var(--color-landing-gold)]"
              : "text-[var(--color-landing-text-muted)]")
          }
        >
          {prediction.pointsEarned > 0
            ? `+${prediction.pointsEarned}`
            : prediction.pointsEarned}{" "}
          pts
        </span>
      </div>
    </section>
  );
}

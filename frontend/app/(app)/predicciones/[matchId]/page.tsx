"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Lock } from "lucide-react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { HTTPError } from "ky";
import { toast } from "sonner";
import { TeamFlag } from "@/components/domain/team-flag";
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
import { cn } from "@/lib/utils/cn";
import type { Match, OutcomeType, Prediction } from "@/lib/api/types";

const PHASE_LABELS: Record<string, string> = {
  GROUPS: "GRUPOS",
  ROUND_32: "16AVOS",
  ROUND_16: "OCTAVOS",
  QUARTERS: "CUARTOS",
  SEMIS: "SEMIS",
  THIRD_PLACE: "3ER PUESTO",
  FINAL: "FINAL",
};

/**
 * Mapping del outcome type a etiqueta visible + tono. El tono dispara
 * el tratamiento de bordes/pts del hero y del breakdown — el mismo
 * lenguaje visual del MatchCard, pero a escala "detalle".
 */
const OUTCOME_VISUAL: Record<
  OutcomeType,
  { label: string; tone: "gold" | "green-strong" | "green" | "muted" }
> = {
  EXACT: { label: "★ EXACTO", tone: "gold" },
  WINNER_AND_DIFF: { label: "✓ GANADOR + DIFERENCIA", tone: "green-strong" },
  WINNER_ONLY: { label: "✓ GANADOR", tone: "green" },
  DRAW_DIFFERENT: { label: "✓ EMPATE DIFERENTE", tone: "green" },
  MISS: { label: "✗ MISS", tone: "muted" },
};

interface PageProps {
  params: Promise<{ matchId: string }>;
}

export default function MatchDetailPage({ params }: PageProps) {
  const { matchId } = use(params);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Modo edición: arranca en false. Si hay prediction guardada, los
  // inputs salen lockeados; el user toca "Editar" para entrar en modo
  // editing y poder modificar.
  const [isEditing, setIsEditing] = useState(false);
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
      // Una vez que el user disparó una mutation (por click en Editar +
      // tipear, o creación inicial sin prediction), mantenemos isEditing=true
      // por el resto de la sesión para que pueda seguir tipiando sin
      // que cada save lockee los inputs. El reset al estado lockeado
      // pasa solo al recargar la página.
      setIsEditing(true);
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
    onError: async (err, _v, ctx) => {
      if (ctx?.prev !== undefined && ctx.cacheKey) {
        queryClient.setQueryData(ctx.cacheKey, ctx.prev);
      }
      // Caso reactivo: el user tenía la página vieja abierta y el backend
      // rechazó porque las predicciones ya cerraron. Le mostramos un mensaje
      // claro y forzamos refetch del match para que la UI flipee a "cerrado".
      if (err instanceof HTTPError) {
        try {
          const body = (await err.response.clone().json()) as {
            code?: string;
          };
          if (body.code === "PREDICTION_LOCKED") {
            toast.error("Las predicciones para este partido ya cerraron.");
            queryClient.invalidateQueries({
              queryKey: queryKeys.matches.detail(matchId),
            });
            return;
          }
        } catch {
          // body no era JSON o falló parse — caemos al toast genérico.
        }
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

  // Caso proactivo: cuando el reloj llega a `predictionsLockAt`, el cron del
  // backend flipea status a LOCKED en su próxima corrida (cada 60s) y el
  // staleTime del query (30s) puede demorar otro tanto. Para que la UI se
  // entere al instante del cierre, programamos un invalidate exactamente
  // 1s después del lockAt — empuja un refetch que ya verá el nuevo status.
  // Cleanup en unmount evita timers huérfanos al cambiar de página.
  const lockAtIso = matchQuery.data?.predictionsLockAt;
  useEffect(() => {
    if (!lockAtIso) return;
    const lockTime = new Date(lockAtIso).getTime();
    const delay = lockTime - Date.now() + 1000;
    if (delay <= 0) return;
    const id = window.setTimeout(() => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.matches.detail(matchId),
      });
    }, delay);
    return () => window.clearTimeout(id);
  }, [lockAtIso, matchId, queryClient]);

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
  // El backend es la fuente de verdad del estado del match. El cron
  // `MatchesCron` flipea SCHEDULED → LOCKED cuando `predictionsLockAt`
  // pasa (corre cada minuto). Acá NO derivamos el lock de `Date.now()`
  // porque eso es impuro en render-phase (React 19 puede re-renderizar
  // y obtener valores distintos). Si hay un gap de hasta ~60s entre el
  // lockAt real y el flip de status, el backend rechaza el submit con
  // 423 LOCKED igual — UX defensiva sin client-side no-determinism.
  const isLocked =
    match.status === "LOCKED" ||
    match.status === "IN_PROGRESS" ||
    match.status === "POSTPONED" ||
    match.status === "CANCELLED";
  const isFinished = match.status === "FINISHED";
  const isInProgress = match.status === "IN_PROGRESS";
  const isCancelled = match.status === "CANCELLED";
  // Partido knockout cuyos equipos todavía no fueron asignados por el
  // admin — el form se bloquea hasta que se resuelvan los grupos previos
  // y vos cargues los equipos desde el panel.
  const isKnockoutPlaceholder =
    match.phase !== "GROUPS" && (!match.homeTeam || !match.awayTeam);
  // Soft-lock contra ediciones accidentales: si ya hay una predicción
  // guardada, los inputs salen lockeados hasta que el user toque "Editar".
  // Una vez en modo edición, queda activo el resto de la sesión (los
  // taps subsiguientes ya son intencionales). Reload o navegar a otro
  // match resetea el lock.
  const hasSavedPrediction = !!prediction;

  const inputDisabled = isLocked || isFinished || isKnockoutPlaceholder;
  const inputsLocked = inputDisabled || (hasSavedPrediction && !isEditing);
  const matchNumberPadded = String(match.matchNumber).padStart(2, "0");

  // Tono del estado abierto para los inputs (saved si hay prediction).
  const inputTone: "default" | "saved" | "empty" =
    prediction ? "saved" : isLocked || isFinished ? "default" : "empty";

  const outcomeVisual =
    isFinished && prediction?.outcomeType
      ? OUTCOME_VISUAL[prediction.outcomeType]
      : null;

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

        {/* Masthead — match number gigante + meta. Editorial print
            style del landing. */}
        <header className="border-t-[4px] border-t-[var(--color-landing-text)] border-b border-b-[var(--color-landing-line)] pt-5 pb-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)] mb-2">
              Detalle del partido
            </div>
            <h1 className="font-[family-name:var(--font-landing-display)] text-[44px] md:text-[56px] uppercase leading-[0.9] tracking-[-0.005em] text-[var(--color-landing-text)] m-0">
              MATCH{" "}
              <span className="text-[var(--color-landing-gold)]">
                {matchNumberPadded}
              </span>
            </h1>
            <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] mt-2">
              {match.groupCode
                ? `GRUPO ${match.groupCode}`
                : PHASE_LABELS[match.phase] ?? match.phase}
              {match.venue ? <> · {match.venue.toUpperCase()}</> : null}
            </div>
          </div>
          <div className="text-right font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)] leading-[1.6] flex-shrink-0">
            <KickoffMeta iso={match.kickoffAt} />
          </div>
        </header>

        {/* HERO scoreboard — crosshair grande con flags 80px */}
        <section
          className={cn(
            "rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)]",
            outcomeVisual?.tone === "gold" &&
              "border-[rgba(200,160,83,0.5)] border-t-[4px] border-t-[var(--color-landing-gold)]",
            outcomeVisual?.tone === "green-strong" &&
              "border-t-[4px] border-t-[var(--color-landing-green)]",
            outcomeVisual?.tone === "green" &&
              "border-t-[3px] border-t-[rgba(92,120,71,0.6)]",
            outcomeVisual?.tone === "muted" &&
              "opacity-[0.85] border-t-[2px] border-t-[var(--color-landing-line)]",
          )}
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-6 md:p-8">
            <DetailTeamSide
              name={homeName}
              fifaCode={home?.fifaCode}
              flagUrl={home?.flagUrl}
            />
            <div className="flex flex-col items-center justify-center gap-2 min-w-[120px] md:min-w-[160px]">
              {isFinished &&
              match.scoreHome !== null &&
              match.scoreAway !== null ? (
                <>
                  <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
                    Resultado
                  </span>
                  <DetailOfficialBlock
                    scoreHome={match.scoreHome}
                    scoreAway={match.scoreAway}
                    highlight={outcomeVisual?.tone === "gold"}
                  />
                  {match.status === "FINISHED" && match.winnerTeam ? (
                    <p className="mt-1 font-[family-name:var(--font-landing-mono)] text-[12px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
                      Pasa {match.winnerTeam.name}
                    </p>
                  ) : null}
                  {prediction ? (
                    <DetailYourPrediction
                      prediction={prediction}
                      tone={outcomeVisual?.tone ?? "muted"}
                    />
                  ) : null}
                </>
              ) : (
                <span className="font-[family-name:var(--font-landing-display)] text-[36px] md:text-[44px] uppercase tracking-tight text-[var(--color-landing-gold)] leading-none">
                  VS
                </span>
              )}
            </div>
            <DetailTeamSide
              name={awayName}
              fifaCode={away?.fifaCode}
              flagUrl={away?.flagUrl}
            />
          </div>
          {isFinished && outcomeVisual ? (
            <div
              className={cn(
                "flex items-center justify-between px-6 py-3 border-t border-[var(--color-landing-line)] bg-[var(--color-landing-surface-2)]",
                "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em]",
              )}
            >
              <span
                className={cn(
                  outcomeVisual.tone === "gold" &&
                    "text-[var(--color-landing-gold)]",
                  outcomeVisual.tone === "green-strong" &&
                    "text-[var(--color-landing-green)]",
                  outcomeVisual.tone === "green" &&
                    "text-[var(--color-landing-green)]",
                  outcomeVisual.tone === "muted" &&
                    "text-[var(--color-landing-text-muted)]",
                )}
              >
                {outcomeVisual.label}
              </span>
              {prediction ? (
                <span
                  className={cn(
                    "font-[family-name:var(--font-landing-display)] text-[18px] tracking-[0.04em] leading-none px-3 py-1 rounded-sm",
                    outcomeVisual.tone === "gold" &&
                      "bg-[rgba(200,160,83,0.18)] border border-[var(--color-landing-gold)] text-[var(--color-landing-gold)]",
                    outcomeVisual.tone === "green-strong" &&
                      "bg-[rgba(92,120,71,0.18)] border border-[var(--color-landing-green)] text-[var(--color-landing-green)]",
                    outcomeVisual.tone === "green" &&
                      "border border-[rgba(92,120,71,0.5)] text-[var(--color-landing-green)]",
                    outcomeVisual.tone === "muted" &&
                      "border border-[var(--color-landing-line-strong)] text-[var(--color-landing-text-muted)]",
                  )}
                >
                  {prediction.pointsEarned > 0
                    ? `+${prediction.pointsEarned} PTS`
                    : "0 PTS"}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Estado de cierre — solo si no está finalizado */}
        {!isFinished ? (
          <section
            className={cn(
              "rounded-sm border bg-[var(--color-landing-surface)] p-4",
              isCancelled
                ? "border-[var(--color-landing-red)]"
                : "border-[var(--color-landing-line-strong)]",
            )}
          >
            {isCancelled ? (
              <div className="flex items-center gap-2 text-[var(--color-landing-red)]">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-landing-red)]" />
                <span className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em]">
                  Cancelado · este partido no se juega
                </span>
              </div>
            ) : isKnockoutPlaceholder ? (
              <div className="flex items-center gap-2 text-[var(--color-landing-text-muted)]">
                <Lock className="h-4 w-4" aria-hidden />
                <span className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em]">
                  Esperando que se definan los equipos
                </span>
              </div>
            ) : isLocked ? (
              <div className="flex items-center gap-2 text-[var(--color-landing-text-muted)]">
                {isInProgress ? (
                  <>
                    <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-landing-red)] match-blink" />
                    <span className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-red)]">
                      En vivo · predicciones cerradas
                    </span>
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" aria-hidden />
                    <span className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em]">
                      Predicciones cerradas
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
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

        {/* Tu pronóstico — bordered card con eyebrow gold/green */}
        {!isFinished ? (
          <section
            className={cn(
              "rounded-sm border bg-[var(--color-landing-surface)] p-6",
              prediction
                ? "border-t-[3px] border-t-[var(--color-landing-green)] border-x-[var(--color-landing-line-strong)] border-b-[var(--color-landing-line-strong)]"
                : !isLocked
                  ? "border-t-[3px] border-t-[var(--color-landing-gold)] border-x-[var(--color-landing-line-strong)] border-b-[var(--color-landing-line-strong)]"
                  : "border-[var(--color-landing-line-strong)]",
            )}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-[family-name:var(--font-landing-display)] text-[24px] uppercase tracking-tight text-[var(--color-landing-text)] m-0">
                Tu pronóstico
              </h2>
              {prediction ? (
                <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-green)]">
                  ✓ Guardado
                </span>
              ) : !isLocked ? (
                <span className="inline-flex items-center gap-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-gold)]">
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-landing-gold)] pulse-dot-gold" />
                  Pendiente
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <span className="font-[family-name:var(--font-landing-display)] text-[20px] md:text-[22px] uppercase tracking-[0.01em] truncate text-[var(--color-landing-text)]">
                  {homeName}
                </span>
                <PredictionInput
                  value={prediction?.scoreHome ?? null}
                  disabled={inputsLocked}
                  tone={inputTone}
                  onOpenSheet={() => setSheetOpen(true)}
                  onChange={(s) => s !== null && handlePredict(s, "home")}
                  ariaLabel={`Prediccion ${homeName}`}
                  className={!prediction && !isLocked ? "input-pulse" : undefined}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="font-[family-name:var(--font-landing-display)] text-[20px] md:text-[22px] uppercase tracking-[0.01em] truncate text-[var(--color-landing-text)]">
                  {awayName}
                </span>
                <PredictionInput
                  value={prediction?.scoreAway ?? null}
                  disabled={inputsLocked}
                  tone={inputTone}
                  onOpenSheet={() => setSheetOpen(true)}
                  onChange={(s) => s !== null && handlePredict(s, "away")}
                  ariaLabel={`Prediccion ${awayName}`}
                  className={!prediction && !isLocked ? "input-pulse" : undefined}
                />
              </div>
            </div>

            {!inputDisabled ? (
              <div className="mt-5">
                {hasSavedPrediction && !isEditing ? (
                  <>
                    {/* Mobile: tap unlock + abre sheet en un solo paso */}
                    <Button
                      type="button"
                      variant="primary"
                      size="lg"
                      className="w-full md:hidden"
                      onClick={() => {
                        setIsEditing(true);
                        setSheetOpen(true);
                      }}
                    >
                      Editar pronóstico
                    </Button>
                    {/* Desktop: solo unlock; el user tipea en los inputs */}
                    <Button
                      type="button"
                      variant="primary"
                      size="lg"
                      className="hidden md:flex w-full"
                      onClick={() => setIsEditing(true)}
                    >
                      Editar pronóstico
                    </Button>
                  </>
                ) : (
                  // Sin prediction o ya en modo edición: solo el trigger
                  // de sheet en mobile (desktop edita por inputs directos).
                  <div className="md:hidden">
                    <Button
                      type="button"
                      variant="primary"
                      size="lg"
                      className="w-full"
                      onClick={() => setSheetOpen(true)}
                    >
                      {prediction ? "Editar pronóstico" : "Cargar pronóstico"}
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Stats: cuantos predijeron */}
        {countQuery.data ? (
          <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] text-center">
            <span className="font-[family-name:var(--font-landing-display)] text-[16px] text-[var(--color-landing-text)] mr-2 tabular-nums">
              {countQuery.data.count}
            </span>
            {countQuery.data.count === 1
              ? "USUARIO PREDIJO ESTE PARTIDO"
              : "USUARIOS PREDIJERON ESTE PARTIDO"}
          </p>
        ) : null}

        {/* Si finalizado: desglose de puntos */}
        {isFinished && prediction ? (
          <FinishedBreakdown
            match={match}
            prediction={prediction}
            outcomeVisual={outcomeVisual}
          />
        ) : null}
      </div>

      {/* NumberPadSheet compartido */}
      <NumberPadSheet
        open={sheetOpen && !inputsLocked}
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
      className="inline-flex items-center gap-2 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)] transition-colors"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Volver
    </Link>
  );
}

function DetailTeamSide({
  name,
  fifaCode,
  flagUrl,
}: {
  name: string;
  fifaCode?: string;
  flagUrl?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center min-w-0">
      {fifaCode ? (
        <TeamFlag fifaCode={fifaCode} src={flagUrl} size={80} />
      ) : (
        <div className="w-20 h-20 rounded-sm bg-[var(--color-landing-surface-2)] border border-[var(--color-landing-line)]" />
      )}
      {fifaCode ? (
        <span className="font-[family-name:var(--font-landing-mono)] text-[10px] tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          {fifaCode}
        </span>
      ) : null}
      <span className="font-[family-name:var(--font-landing-display)] text-[22px] md:text-[28px] uppercase tracking-[0.01em] leading-[0.95] text-[var(--color-landing-text)] line-clamp-2 max-w-[140px] md:max-w-[180px]">
        {name}
      </span>
    </div>
  );
}

function DetailOfficialBlock({
  scoreHome,
  scoreAway,
  highlight,
}: {
  scoreHome: number;
  scoreAway: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 px-5 py-2 rounded-sm",
        "bg-black/30 border border-[var(--color-landing-line-strong)]",
        highlight && "border-[var(--color-landing-gold)] bg-[rgba(200,160,83,0.08)]",
      )}
    >
      <span
        className={cn(
          "font-[family-name:var(--font-landing-display)] text-[44px] md:text-[56px] leading-none tabular-nums",
          highlight
            ? "text-[var(--color-landing-gold)]"
            : "text-[var(--color-landing-text)]",
        )}
      >
        {scoreHome}
      </span>
      <span className="text-[var(--color-landing-text-muted)] text-[28px] leading-none">
        :
      </span>
      <span
        className={cn(
          "font-[family-name:var(--font-landing-display)] text-[44px] md:text-[56px] leading-none tabular-nums",
          highlight
            ? "text-[var(--color-landing-gold)]"
            : "text-[var(--color-landing-text)]",
        )}
      >
        {scoreAway}
      </span>
    </div>
  );
}

function DetailYourPrediction({
  prediction,
  tone,
}: {
  prediction: Prediction;
  tone: "gold" | "green-strong" | "green" | "muted";
}) {
  const color =
    tone === "gold"
      ? "text-[var(--color-landing-gold)]"
      : tone === "green-strong" || tone === "green"
        ? "text-[var(--color-landing-green)]"
        : "text-[var(--color-landing-text-muted)]";
  return (
    <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
      TU{" "}
      <span
        className={cn(
          "font-[family-name:var(--font-landing-display)] text-[16px] tracking-[0.04em] tabular-nums ml-1",
          color,
        )}
      >
        {prediction.scoreHome} : {prediction.scoreAway}
      </span>
    </span>
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
  return <span className="whitespace-nowrap">{formatted}</span>;
}

function FinishedBreakdown({
  match,
  prediction,
  outcomeVisual,
}: {
  match: Match;
  prediction: Prediction;
  outcomeVisual:
    | { label: string; tone: "gold" | "green-strong" | "green" | "muted" }
    | null;
}) {
  const phase = PHASE_LABELS[match.phase] ?? match.phase;
  const ptsColor =
    outcomeVisual?.tone === "gold"
      ? "text-[var(--color-landing-gold)]"
      : outcomeVisual?.tone === "green-strong" || outcomeVisual?.tone === "green"
        ? "text-[var(--color-landing-green)]"
        : "text-[var(--color-landing-text-muted)]";

  return (
    <section
      className={cn(
        "rounded-sm border bg-[var(--color-landing-surface)] p-6",
        outcomeVisual?.tone === "gold" &&
          "border-[rgba(200,160,83,0.5)] border-t-[3px] border-t-[var(--color-landing-gold)]",
        outcomeVisual?.tone === "green-strong" &&
          "border-[var(--color-landing-line-strong)] border-t-[3px] border-t-[var(--color-landing-green)]",
        outcomeVisual?.tone === "green" &&
          "border-[var(--color-landing-line-strong)] border-t-[3px] border-t-[rgba(92,120,71,0.6)]",
        outcomeVisual?.tone === "muted" &&
          "border-[var(--color-landing-line-strong)]",
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-[family-name:var(--font-landing-display)] text-[24px] uppercase tracking-tight text-[var(--color-landing-text)] m-0">
          Desglose de puntos
        </h2>
        {outcomeVisual ? (
          <span
            className={cn(
              "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em]",
              outcomeVisual.tone === "gold" &&
                "text-[var(--color-landing-gold)]",
              outcomeVisual.tone === "green-strong" &&
                "text-[var(--color-landing-green)]",
              outcomeVisual.tone === "green" &&
                "text-[var(--color-landing-green)]",
              outcomeVisual.tone === "muted" &&
                "text-[var(--color-landing-text-muted)]",
            )}
          >
            {outcomeVisual.label}
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <dt className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Puntos base
        </dt>
        <dd className="font-[family-name:var(--font-landing-display)] text-[16px] tabular-nums text-right text-[var(--color-landing-text)]">
          {prediction.basePoints}
        </dd>

        <dt className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Multiplicador {phase}
        </dt>
        <dd className="font-[family-name:var(--font-landing-display)] text-[16px] tabular-nums text-right text-[var(--color-landing-text)]">
          ×{prediction.multiplier}
        </dd>
      </dl>

      <div className="mt-4 pt-4 border-t border-[var(--color-landing-line)] flex items-center justify-between">
        <span className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
          Total
        </span>
        <span
          className={cn(
            "font-[family-name:var(--font-landing-display)] text-[36px] tabular-nums leading-none",
            ptsColor,
          )}
        >
          {prediction.pointsEarned > 0
            ? `+${prediction.pointsEarned}`
            : prediction.pointsEarned}{" "}
          <span className="text-[20px] tracking-wider">PTS</span>
        </span>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import type { Match, OutcomeType, Prediction } from "@/lib/api/types";
import { TeamFlag } from "@/components/domain/team-flag";
import { PredictionInput } from "@/components/domain/prediction-input";
import { PointsCelebration } from "@/components/domain/points-celebration";
import { useCountdown } from "@/lib/hooks/use-countdown";
import { cn } from "@/lib/utils/cn";

/**
 * Muestra animacion celebratoria solo si la prediction fue evaluada
 * en los ultimos 5 minutos. Asi evitamos animar resultados viejos
 * cada vez que se monta la lista.
 */
const RECENT_EVAL_WINDOW_MS = 5 * 60 * 1000;

export type MatchCardState =
  | "empty" // sin cargar (open match, no prediction)
  | "saved" // cargado abierto (open match, with prediction)
  | "retrying" // sin conexion / reintentando
  | "locked" // locked sin resultado (CERRADO)
  | "finished"; // resultado oficial cargado

/**
 * Sub-estado que se usa SOLO cuando `state === "finished"`. Se mapea
 * desde `prediction.outcomeType` (o "miss" si no hay prediction). Lo
 * exponemos en `data-outcome` para tests + selectors CSS y para
 * elegir el tratamiento visual del card (gold celebración para
 * EXACT, green fuerte para WINNER+DIFF, etc.).
 */
export type FinishedOutcome =
  | "exact"
  | "winner-diff"
  | "winner-only"
  | "draw-different"
  | "miss";

interface MatchCardProps {
  match: Match;
  prediction: Prediction | null | undefined;
  /**
   * Callback al tap del PredictionInput (mobile) — la pagina abre el
   * NumberPadSheet con este matchId activo.
   */
  onOpenSheet?: (matchId: string) => void;
  /**
   * Callback con score final (desde input desktop con debounce manejado
   * por el padre, o desde el sheet de mobile despues de GUARDAR).
   */
  onPredict?: (
    matchId: string,
    dto: { scoreHome: number; scoreAway: number },
  ) => void;
  /**
   * Si la mutacion para esta prediction esta en flight (pending o
   * retrying). El padre lo deriva de `useMutation`.
   */
  loading?: boolean;
  /**
   * Si la ultima mutacion fallo (esto dispara el estado "retrying"
   * con badge accent). El padre lo deriva de `mutation.isError` +
   * algun retry counter local.
   */
  error?: boolean;
}

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
 * Match card "Editorial Scoreboard" v4 — DNA del landing aplicado:
 *  - Top band con `match #` + group chip + meta (kickoff · venue)
 *  - Body crosshair (flag/fifa/name a los lados, prediction o resultado al medio)
 *  - Foot con state badge + pts badge tipográfico
 *  - Cada estado tiene tratamiento visual notorio: border-top color +
 *    grosor + bg gradient o pattern. 4 sub-estados de finished
 *    (exact, winner-diff, winner-only/draw-different, miss).
 *  - Animaciones puntuales: input-pulse en empty, match-shake al entrar
 *    en retrying, pulse-dot en pendiente / live-blink en IN_PROGRESS.
 *  - reduced-motion respetado via globals.css.
 */
export function MatchCard({
  match,
  prediction,
  onOpenSheet,
  onPredict,
  loading = false,
  error = false,
}: MatchCardProps) {
  const state = computeState({ match, prediction, loading, error });
  const finishedOutcome: FinishedOutcome | null =
    state === "finished" ? computeFinishedOutcome(prediction) : null;

  // Shake one-shot al pasar a retrying. useEffect mete la clase y la
  // saca a los 400ms para que la animación no se reproduzca en cada
  // re-render mientras `error` sigue true.
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (state === "retrying") {
      setShake(true);
      const id = window.setTimeout(() => setShake(false), 400);
      return () => window.clearTimeout(id);
    }
  }, [state]);

  const home = match.homeTeam;
  const away = match.awayTeam;
  const homeName = home?.name ?? match.homeTeamLabel ?? "Por definir";
  const awayName = away?.name ?? match.awayTeamLabel ?? "Por definir";

  // CANCELLED se mapea a state="locked" para deshabilitar inputs igual que
  // un partido cerrado, pero queremos comunicar visualmente que el partido
  // NO se juega (no es lo mismo que "ya empezó / cerrado por kickoff").
  const isCancelled = match.status === "CANCELLED";
  // Partidos de fase knockout cuyos equipos todavía no fueron asignados
  // por el admin (hasta que terminen los grupos previos). El form no debe
  // aceptar predicciones contra placeholders — el user no sabe contra
  // quién está apostando realmente.
  const isKnockoutPlaceholder =
    match.phase !== "GROUPS" && (!match.homeTeam || !match.awayTeam);
  const inputDisabled =
    state === "locked" || state === "finished" || isKnockoutPlaceholder;
  const matchNumberPadded = String(match.matchNumber).padStart(2, "0");
  const isInProgress = match.status === "IN_PROGRESS";

  // Sub-estado tone para los inputs del PredictionInput (color de border).
  // Solo aplica en estados open; locked/finished usan disabled tone propio.
  const inputTone: "default" | "saved" | "retrying" | "empty" =
    state === "saved"
      ? "saved"
      : state === "retrying"
        ? "retrying"
        : state === "empty"
          ? "empty"
          : "default";

  return (
    <article
      className={cn(
        // Base
        "relative overflow-hidden rounded-sm transition-colors duration-200",
        "border border-[var(--color-landing-line-strong)]",
        "bg-[var(--color-landing-surface)]",
        // Border-top tinted by state (más grueso = más urgencia)
        state === "empty" && "border-t-[4px] border-t-[var(--color-landing-gold)]",
        state === "saved" && "border-t-[4px] border-t-[var(--color-landing-green)]",
        state === "retrying" && "border-t-[4px] border-t-[var(--color-landing-red)]",
        state === "locked" && !isCancelled && "border-t-[2px] border-t-[var(--color-landing-line-strong)] opacity-[0.85]",
        isCancelled && "border-t-[3px] border-t-[var(--color-landing-red)] opacity-[0.7]",
        // Finished sub-states
        finishedOutcome === "exact" &&
          "border-[rgba(200,160,83,0.5)] border-t-[4px] border-t-[var(--color-landing-gold)] shadow-[0_0_0_1px_rgba(200,160,83,0.1)]",
        finishedOutcome === "winner-diff" &&
          "border-t-[4px] border-t-[var(--color-landing-green)]",
        (finishedOutcome === "winner-only" ||
          finishedOutcome === "draw-different") &&
          "border-t-[3px] border-t-[rgba(92,120,71,0.6)]",
        finishedOutcome === "miss" &&
          "border-t-[2px] border-t-[var(--color-landing-line)] opacity-[0.62]",
        shake && "match-shake",
      )}
      style={
        // Background gradient/pattern por estado (más expresivo que solid)
        state === "empty"
          ? {
              backgroundImage:
                "linear-gradient(180deg, rgba(200, 160, 83, 0.08) 0%, transparent 35%)",
            }
          : state === "saved"
            ? {
                backgroundImage:
                  "linear-gradient(180deg, rgba(92, 120, 71, 0.08) 0%, transparent 35%)",
              }
            : state === "retrying"
              ? {
                  backgroundImage:
                    "linear-gradient(180deg, rgba(163, 61, 61, 0.10) 0%, transparent 35%)",
                }
              : state === "locked"
                ? {
                    backgroundImage:
                      "repeating-linear-gradient(135deg, transparent 0, transparent 16px, rgba(241,236,224,0.015) 16px, rgba(241,236,224,0.015) 17px)",
                  }
                : finishedOutcome === "exact"
                  ? {
                      backgroundImage:
                        "linear-gradient(180deg, rgba(200, 160, 83, 0.10) 0%, transparent 50%)",
                    }
                  : finishedOutcome === "winner-diff"
                    ? {
                        backgroundImage:
                          "linear-gradient(180deg, rgba(92, 120, 71, 0.08) 0%, transparent 40%)",
                      }
                    : finishedOutcome === "miss"
                      ? {
                          backgroundImage:
                            "repeating-linear-gradient(135deg, transparent 0, transparent 12px, rgba(0,0,0,0.08) 12px, rgba(0,0,0,0.08) 13px)",
                        }
                      : undefined
      }
      aria-label={`${homeName} vs ${awayName}`}
      data-state={state}
      data-outcome={finishedOutcome ?? undefined}
    >
      {/* TOP BAND — match # + group chip + meta */}
      <header
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2",
          "border-b border-[var(--color-landing-line)]",
          "bg-[var(--color-landing-surface-2)]",
          state === "locked" && "bg-black/30",
          "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em]",
          "text-[var(--color-landing-text-muted)]",
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={cn(
              "font-[family-name:var(--font-landing-display)] text-[14px] leading-none tracking-wider",
              "transition-colors duration-200",
              state === "empty" && "text-[var(--color-landing-gold)]",
              state === "saved" && "text-[var(--color-landing-green)]",
              state === "retrying" && "text-[var(--color-landing-red)]",
              state === "locked" && "text-[var(--color-landing-text-muted)]",
              finishedOutcome === "exact" && "text-[var(--color-landing-gold)]",
              finishedOutcome === "winner-diff" && "text-[var(--color-landing-green)]",
              (finishedOutcome === "winner-only" ||
                finishedOutcome === "draw-different") &&
                "text-[rgba(92,120,71,0.85)]",
              finishedOutcome === "miss" && "text-[var(--color-landing-text-muted)]",
            )}
          >
            {matchNumberPadded}
          </span>
          {match.groupCode ? (
            <span
              className={cn(
                "inline-flex px-1.5 py-0.5 rounded-sm",
                "font-[family-name:var(--font-landing-mono)] text-[9px] tracking-[0.16em]",
                "border border-[rgba(62,84,137,0.4)] bg-[rgba(62,84,137,0.18)] text-[#95a8d4]",
              )}
            >
              GRUPO {match.groupCode}
            </span>
          ) : (
            <span className="text-[var(--color-landing-text-muted)]">
              {PHASE_LABELS[match.phase] ?? match.phase}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0 truncate">
          <KickoffTime iso={match.kickoffAt} />
          {match.venue ? (
            <>
              <span className="opacity-50">·</span>
              <span className="truncate">{match.venue.toUpperCase()}</span>
            </>
          ) : null}
        </div>
      </header>

      {/* SCOREBOARD — crosshair body */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-4 md:px-4 md:py-5">
        <TeamSide
          name={homeName}
          fifaCode={home?.fifaCode}
          flagUrl={home?.flagUrl}
        />
        <CenterCol
          state={state}
          finishedOutcome={finishedOutcome}
          match={match}
          prediction={prediction}
          inputDisabled={inputDisabled}
          inputTone={inputTone}
          isInProgress={isInProgress}
          isKnockoutPlaceholder={isKnockoutPlaceholder}
          onOpenSheet={() => onOpenSheet?.(match.id)}
          onPredict={onPredict}
          homeName={homeName}
          awayName={awayName}
        />
        <TeamSide
          name={awayName}
          fifaCode={away?.fifaCode}
          flagUrl={away?.flagUrl}
        />
      </div>

      {/* FOOT — state badge + pts badge */}
      <footer
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2.5",
          "border-t border-[var(--color-landing-line)]",
          "bg-[var(--color-landing-surface-2)]",
          state === "locked" && "bg-black/30",
          "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em]",
        )}
      >
        <FootLeft
          state={state}
          finishedOutcome={finishedOutcome}
          match={match}
          isInProgress={isInProgress}
          isKnockoutPlaceholder={isKnockoutPlaceholder}
        />
        <FootRight
          state={state}
          finishedOutcome={finishedOutcome}
          prediction={prediction}
          match={match}
          isKnockoutPlaceholder={isKnockoutPlaceholder}
        />
      </footer>

      {/* Celebración de puntos — solo eval reciente + pts > 0 */}
      {state === "finished" && prediction && shouldCelebrate(prediction) ? (
        <div className="px-4 pb-3 -mt-1">
          <PointsCelebration points={prediction.pointsEarned} />
        </div>
      ) : null}
    </article>
  );
}

function computeState({
  match,
  prediction,
  loading,
  error,
}: {
  match: Match;
  prediction: Prediction | null | undefined;
  loading: boolean;
  error: boolean;
}): MatchCardState {
  if (match.status === "FINISHED") return "finished";
  if (
    match.status === "LOCKED" ||
    match.status === "IN_PROGRESS" ||
    match.status === "POSTPONED" ||
    match.status === "CANCELLED"
  ) {
    return "locked";
  }
  if (error || loading) return "retrying";
  if (prediction) return "saved";
  return "empty";
}

function computeFinishedOutcome(
  prediction: Prediction | null | undefined,
): FinishedOutcome {
  // Sin prediction o sin outcomeType evaluado todavía → tratar como miss.
  // (Si el match ya está FINISHED y la evaluación llegó, outcomeType
  // estará seteado.)
  if (!prediction || !prediction.outcomeType) return "miss";
  return outcomeToSubtype(prediction.outcomeType);
}

function outcomeToSubtype(o: OutcomeType): FinishedOutcome {
  switch (o) {
    case "EXACT":
      return "exact";
    case "WINNER_AND_DIFF":
      return "winner-diff";
    case "WINNER_ONLY":
      return "winner-only";
    case "DRAW_DIFFERENT":
      return "draw-different";
    case "MISS":
      return "miss";
  }
}

function shouldCelebrate(prediction: Prediction): boolean {
  if (!prediction.evaluatedAt) return false;
  if (prediction.pointsEarned <= 0) return false;
  const elapsed = Date.now() - new Date(prediction.evaluatedAt).getTime();
  return elapsed < RECENT_EVAL_WINDOW_MS;
}

interface TeamSideProps {
  name: string;
  fifaCode?: string;
  flagUrl?: string;
}

function TeamSide({ name, fifaCode, flagUrl }: TeamSideProps) {
  return (
    <div className="flex flex-col items-center gap-2 text-center min-w-0">
      {fifaCode ? (
        <TeamFlag fifaCode={fifaCode} src={flagUrl} size={56} />
      ) : (
        <div className="w-14 h-14 rounded-sm bg-[var(--color-landing-surface-2)] border border-[var(--color-landing-line)]" />
      )}
      {fifaCode ? (
        <span className="font-[family-name:var(--font-landing-mono)] text-[10px] tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          {fifaCode}
        </span>
      ) : null}
      <span
        className={cn(
          "font-[family-name:var(--font-landing-display)] text-[18px] md:text-[22px]",
          "uppercase tracking-[0.01em] leading-[0.95]",
          "text-[var(--color-landing-text)] max-w-[110px] md:max-w-[160px] line-clamp-2",
        )}
      >
        {name}
      </span>
    </div>
  );
}

interface CenterColProps {
  state: MatchCardState;
  finishedOutcome: FinishedOutcome | null;
  match: Match;
  prediction: Prediction | null | undefined;
  inputDisabled: boolean;
  inputTone: "default" | "saved" | "retrying" | "empty";
  isInProgress: boolean;
  isKnockoutPlaceholder: boolean;
  onOpenSheet: () => void;
  onPredict?: (
    matchId: string,
    dto: { scoreHome: number; scoreAway: number },
  ) => void;
  homeName: string;
  awayName: string;
}

function CenterCol({
  state,
  finishedOutcome,
  match,
  prediction,
  inputDisabled,
  inputTone,
  isInProgress,
  isKnockoutPlaceholder,
  onOpenSheet,
  onPredict,
  homeName,
  awayName,
}: CenterColProps) {
  // Eyebrow encima del input/score
  const eyebrowText =
    state === "finished"
      ? "Resultado"
      : state === "saved"
        ? "✓ Tu pronóstico"
        : state === "retrying"
          ? "⚠ No guardado"
          : state === "locked"
            ? "Pronóstico"
            : "Tu pronóstico";

  const eyebrowColor =
    state === "saved"
      ? "text-[var(--color-landing-green)]"
      : state === "retrying"
        ? "text-[var(--color-landing-red)]"
        : state === "empty"
          ? "text-[var(--color-landing-gold)]"
          : finishedOutcome === "exact"
            ? "text-[var(--color-landing-gold)]"
            : "text-[var(--color-landing-text-muted)]";

  // VS / EN VIVO / CANCELADO / EN JUEGO / FINALIZADO / TBD under the inputs
  const isCancelled = match.status === "CANCELLED";
  const subText = isKnockoutPlaceholder
    ? "TBD"
    : state === "locked"
      ? isCancelled
        ? "CANCELADO"
        : isInProgress
          ? "EN VIVO"
          : "EN JUEGO"
      : state === "finished"
        ? null
        : "VS";

  const inputClassName = cn(
    state === "empty" && "input-pulse",
    state === "saved" &&
      "border-[var(--color-landing-green)] focus:border-[var(--color-landing-green)]",
    state === "retrying" && "border-[var(--color-landing-red)]",
  );

  if (state === "finished") {
    return (
      <div className="flex flex-col items-center gap-1.5 min-w-[120px] md:min-w-[140px]">
        <span
          className={cn(
            "font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.22em]",
            eyebrowColor,
          )}
        >
          {eyebrowText}
        </span>
        <OfficialBlock
          scoreHome={match.scoreHome}
          scoreAway={match.scoreAway}
          highlight={finishedOutcome === "exact"}
        />
        {match.status === "FINISHED" && match.winnerTeam ? (
          <p className="mt-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
            Pasa {match.winnerTeam.name}
          </p>
        ) : null}
        <YourPrediction
          prediction={prediction}
          finishedOutcome={finishedOutcome}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5 min-w-[120px] md:min-w-[140px]">
      <span
        className={cn(
          "font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.22em]",
          eyebrowColor,
        )}
      >
        {eyebrowText}
      </span>
      <div className="flex items-center gap-1">
        <PredictionInput
          value={prediction?.scoreHome ?? null}
          disabled={inputDisabled}
          tone={inputTone}
          onOpenSheet={onOpenSheet}
          onChange={(score) => {
            if (score === null) return;
            const otherScore = prediction?.scoreAway ?? null;
            if (otherScore === null) return;
            onPredict?.(match.id, { scoreHome: score, scoreAway: otherScore });
          }}
          ariaLabel={`Prediccion ${homeName}`}
          className={inputClassName}
        />
        <span className="font-[family-name:var(--font-landing-display)] text-[20px] leading-none text-[var(--color-landing-gold)]">
          :
        </span>
        <PredictionInput
          value={prediction?.scoreAway ?? null}
          disabled={inputDisabled}
          tone={inputTone}
          onOpenSheet={onOpenSheet}
          onChange={(score) => {
            if (score === null) return;
            const otherScore = prediction?.scoreHome ?? null;
            if (otherScore === null) return;
            onPredict?.(match.id, { scoreHome: otherScore, scoreAway: score });
          }}
          ariaLabel={`Prediccion ${awayName}`}
          className={inputClassName}
        />
      </div>
      {subText ? (
        <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-gold)]">
          {subText}
        </span>
      ) : null}
    </div>
  );
}

function OfficialBlock({
  scoreHome,
  scoreAway,
  highlight,
}: {
  scoreHome: number | null;
  scoreAway: number | null;
  highlight: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-sm",
        "bg-black/25 border border-[var(--color-landing-line-strong)]",
        highlight && "border-[var(--color-landing-gold)] bg-[rgba(200,160,83,0.08)]",
      )}
    >
      <span
        className={cn(
          "font-[family-name:var(--font-landing-display)] text-[28px] leading-none tabular-nums",
          highlight
            ? "text-[var(--color-landing-gold)]"
            : "text-[var(--color-landing-text)]",
        )}
      >
        {scoreHome ?? "—"}
      </span>
      <span className="text-[var(--color-landing-text-muted)] text-[20px] leading-none">
        :
      </span>
      <span
        className={cn(
          "font-[family-name:var(--font-landing-display)] text-[28px] leading-none tabular-nums",
          highlight
            ? "text-[var(--color-landing-gold)]"
            : "text-[var(--color-landing-text)]",
        )}
      >
        {scoreAway ?? "—"}
      </span>
    </div>
  );
}

function YourPrediction({
  prediction,
  finishedOutcome,
}: {
  prediction: Prediction | null | undefined;
  finishedOutcome: FinishedOutcome | null;
}) {
  if (!prediction) {
    return (
      <span className="font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        SIN PRONÓSTICO
      </span>
    );
  }
  const tone =
    finishedOutcome === "exact"
      ? "text-[var(--color-landing-gold)]"
      : finishedOutcome === "winner-diff" ||
          finishedOutcome === "winner-only" ||
          finishedOutcome === "draw-different"
        ? "text-[var(--color-landing-green)]"
        : "text-[var(--color-landing-text-muted)]";
  return (
    <span className="font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)] leading-tight">
      TU{" "}
      <span
        className={cn(
          "font-[family-name:var(--font-landing-display)] text-[14px] tracking-[0.04em] tabular-nums ml-1",
          tone,
        )}
      >
        {prediction.scoreHome} : {prediction.scoreAway}
      </span>
    </span>
  );
}

function FootLeft({
  state,
  finishedOutcome,
  match,
  isInProgress,
  isKnockoutPlaceholder,
}: {
  state: MatchCardState;
  finishedOutcome: FinishedOutcome | null;
  match: Match;
  isInProgress: boolean;
  isKnockoutPlaceholder: boolean;
}) {
  if (isKnockoutPlaceholder) {
    return (
      <span className="text-[var(--color-landing-text-muted)]">
        ESPERANDO EQUIPOS
      </span>
    );
  }
  if (state === "finished") {
    return <FinishedFootLabel finishedOutcome={finishedOutcome} />;
  }
  if (state === "locked") {
    if (match.status === "CANCELLED") {
      return (
        <span className="inline-flex items-center gap-2 text-[var(--color-landing-red)]">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-landing-red)]" />
          CANCELADO
        </span>
      );
    }
    if (isInProgress) {
      return (
        <span className="inline-flex items-center gap-2 text-[var(--color-landing-red)]">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-landing-red)] match-blink" />
          EN VIVO
        </span>
      );
    }
    return (
      <span className="text-[var(--color-landing-text-muted)]">CERRADO</span>
    );
  }
  return <CountdownLabel match={match} />;
}

function FootRight({
  state,
  finishedOutcome,
  prediction,
  match,
  isKnockoutPlaceholder,
}: {
  state: MatchCardState;
  finishedOutcome: FinishedOutcome | null;
  prediction: Prediction | null | undefined;
  match: Match;
  isKnockoutPlaceholder: boolean;
}) {
  if (isKnockoutPlaceholder) {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--color-landing-text-muted)]">
        <Lock className="h-3 w-3" aria-hidden />
        TBD
      </span>
    );
  }
  if (state === "empty") {
    return (
      <span className="inline-flex items-center gap-2 text-[var(--color-landing-gold)]">
        <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-landing-gold)] pulse-dot-gold" />
        FALTA TU PRONÓSTICO
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="text-[var(--color-landing-green)]">✓ GUARDADO</span>
    );
  }
  if (state === "retrying") {
    return (
      <span className="inline-flex items-center gap-2 text-[var(--color-landing-red)]">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        REINTENTANDO...
      </span>
    );
  }
  if (state === "locked") {
    if (match.status === "CANCELLED") {
      return (
        <span className="inline-flex items-center gap-1 text-[var(--color-landing-red)]">
          <Lock className="h-3 w-3" aria-hidden />
          CANCELADO
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[var(--color-landing-text-muted)]">
        <Lock className="h-3 w-3" aria-hidden />
        CERRADO
      </span>
    );
  }
  // finished — pts badge tipográfico
  return <PtsBadge prediction={prediction} finishedOutcome={finishedOutcome} />;
}

function FinishedFootLabel({
  finishedOutcome,
}: {
  finishedOutcome: FinishedOutcome | null;
}) {
  switch (finishedOutcome) {
    case "exact":
      return (
        <span className="text-[var(--color-landing-gold)]">★ EXACTO</span>
      );
    case "winner-diff":
      return (
        <span className="text-[var(--color-landing-green)]">
          ✓ GANADOR + DIFERENCIA
        </span>
      );
    case "winner-only":
      return (
        <span className="text-[var(--color-landing-green)]">✓ GANADOR</span>
      );
    case "draw-different":
      return (
        <span className="text-[var(--color-landing-green)]">✓ EMPATE</span>
      );
    case "miss":
    default:
      return (
        <span className="text-[var(--color-landing-text-muted)]">✗ MISS</span>
      );
  }
}

function PtsBadge({
  prediction,
  finishedOutcome,
}: {
  prediction: Prediction | null | undefined;
  finishedOutcome: FinishedOutcome | null;
}) {
  const pts = prediction?.pointsEarned ?? 0;
  const label = pts > 0 ? `+${pts} PTS` : "0 PTS";

  const cls = cn(
    "inline-flex items-center px-2.5 py-1 rounded-sm",
    "font-[family-name:var(--font-landing-display)] text-[14px] tracking-[0.04em] leading-none",
    finishedOutcome === "exact" &&
      "bg-[rgba(200,160,83,0.18)] border border-[var(--color-landing-gold)] text-[var(--color-landing-gold)]",
    finishedOutcome === "winner-diff" &&
      "bg-[rgba(92,120,71,0.18)] border border-[var(--color-landing-green)] text-[var(--color-landing-green)]",
    (finishedOutcome === "winner-only" ||
      finishedOutcome === "draw-different") &&
      "border border-[rgba(92,120,71,0.5)] text-[var(--color-landing-green)]",
    finishedOutcome === "miss" &&
      "border border-[var(--color-landing-line-strong)] text-[var(--color-landing-text-muted)]",
  );
  return <span className={cls}>{label}</span>;
}

function KickoffTime({ iso }: { iso: string }) {
  // kickoffAt llega en UTC; renderizamos en la TZ del browser del
  // usuario (Intl sin timeZone explícito).
  try {
    const d = new Date(iso);
    const formatter = new Intl.DateTimeFormat("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const tzShort = new Intl.DateTimeFormat("es-AR", {
      timeZoneName: "short",
    })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value;
    return (
      <span className="whitespace-nowrap">
        {formatter.format(d)}
        {tzShort ? ` ${tzShort}` : ""}
      </span>
    );
  } catch {
    return <span>--:--</span>;
  }
}

function CountdownLabel({ match }: { match: Match }) {
  const parts = useCountdown(match.predictionsLockAt);
  if (!parts) {
    return (
      <span className="text-[var(--color-landing-text-muted)]">
        Cierra pronto
      </span>
    );
  }
  if (parts.finished) {
    return <span className="text-[var(--color-landing-red)]">CERRADO</span>;
  }
  const label =
    parts.days > 0
      ? `${parts.days}D ${parts.hours}H`
      : parts.hours > 0
        ? `${parts.hours}H ${parts.minutes}M`
        : `${parts.minutes}M ${parts.seconds.toString().padStart(2, "0")}S`;
  return (
    <span className="text-[var(--color-landing-text-muted)]">
      Cierra en {label}
    </span>
  );
}

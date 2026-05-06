"use client";

import { Lock, Loader2, RefreshCw } from "lucide-react";
import type { Match, Prediction } from "@/lib/api/types";
import { TeamFlag } from "@/components/domain/team-flag";
import { ScoreDisplay } from "@/components/domain/score-display";
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
 * Match card con los 5 estados visuales del spec §6.4 repintada con la
 * paleta dark editorial (`--color-landing-*`). Sin opacity en el
 * locked state — preservar contraste WCAG AA es prioridad.
 *
 * El card es informativo (no clickable globalmente). Los inputs de
 * la prediccion son los puntos de interaccion. La pagina detalle
 * (`/predicciones/[matchId]`) se navega via boton dedicado o
 * Link wrapper — esto evita gestos accidentales en mobile.
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
  const home = match.homeTeam;
  const away = match.awayTeam;
  const homeName = home?.name ?? match.homeTeamLabel ?? "Por definir";
  const awayName = away?.name ?? match.awayTeamLabel ?? "Por definir";

  const inputDisabled = state === "locked" || state === "finished";
  const finishedWithPoints =
    state === "finished" && prediction !== null && prediction !== undefined && prediction.pointsEarned > 0;

  return (
    <article
      className={cn(
        "rounded-sm p-5 transition-colors",
        // Flat elevation: bg surface base, surface-2 cuando locked.
        state === "empty" &&
          "bg-[var(--color-landing-surface)] border border-[var(--color-landing-line-strong)]",
        state === "saved" &&
          "bg-[var(--color-landing-surface)] border-2 border-[var(--color-landing-text)]",
        state === "retrying" &&
          "bg-[var(--color-landing-surface)] border-2 border-[var(--color-landing-red)]",
        state === "locked" &&
          "bg-[var(--color-landing-surface-2)] border border-[var(--color-landing-line)]",
        state === "finished" &&
          (finishedWithPoints
            ? "bg-[var(--color-landing-surface)] border-2 border-[var(--color-landing-green)]"
            : "bg-[var(--color-landing-surface)] border border-[var(--color-landing-line-strong)]"),
      )}
      aria-label={`${homeName} vs ${awayName}`}
      data-state={state}
    >
      {/* Header meta — eyebrow mono uppercase tracked */}
      <header
        className={cn(
          "flex items-center justify-between gap-2 mb-4",
          "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em]",
          state === "locked"
            ? "text-[var(--color-landing-text-muted)]"
            : "text-[var(--color-landing-text-muted)]",
        )}
      >
        <span className="truncate">
          {match.groupCode
            ? `GRUPO ${match.groupCode}`
            : PHASE_LABELS[match.phase] ?? match.phase}
          {" · "}
          <KickoffTime iso={match.kickoffAt} />
          {match.venue ? <> {" · "}{match.venue.toUpperCase()}</> : null}
        </span>
      </header>

      {/* Body: 2 rows */}
      <div className="flex flex-col gap-4">
        <TeamRow
          name={homeName}
          fifaCode={home?.fifaCode}
          flagUrl={home?.flagUrl}
          predictionScore={prediction?.scoreHome ?? null}
          finalScore={state === "finished" ? match.scoreHome : null}
          disabled={inputDisabled}
          onOpenSheet={() => onOpenSheet?.(match.id)}
          onChange={(score) => {
            if (score === null) return;
            const otherScore = prediction?.scoreAway ?? null;
            if (otherScore === null) return;
            onPredict?.(match.id, { scoreHome: score, scoreAway: otherScore });
          }}
          ariaLabel={`Prediccion ${homeName}`}
        />
        <TeamRow
          name={awayName}
          fifaCode={away?.fifaCode}
          flagUrl={away?.flagUrl}
          predictionScore={prediction?.scoreAway ?? null}
          finalScore={state === "finished" ? match.scoreAway : null}
          disabled={inputDisabled}
          onOpenSheet={() => onOpenSheet?.(match.id)}
          onChange={(score) => {
            if (score === null) return;
            const otherScore = prediction?.scoreHome ?? null;
            if (otherScore === null) return;
            onPredict?.(match.id, { scoreHome: otherScore, scoreAway: score });
          }}
          ariaLabel={`Prediccion ${awayName}`}
        />
      </div>

      {/* Footer: countdown + state badge */}
      <footer className="mt-5 flex items-center justify-between gap-3">
        <Countdown match={match} state={state} />
        <StateBadge state={state} prediction={prediction} />
      </footer>

      {/* Finished — show points + breakdown when prediction exists */}
      {state === "finished" && prediction ? (
        <FinishedSummary
          match={match}
          prediction={prediction}
        />
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

interface TeamRowProps {
  name: string;
  fifaCode?: string;
  flagUrl?: string;
  predictionScore: number | null;
  finalScore: number | null;
  disabled: boolean;
  onOpenSheet: () => void;
  onChange: (score: number | null) => void;
  ariaLabel: string;
}

function TeamRow({
  name,
  fifaCode,
  flagUrl,
  predictionScore,
  finalScore,
  disabled,
  onOpenSheet,
  onChange,
  ariaLabel,
}: TeamRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {fifaCode ? <TeamFlag fifaCode={fifaCode} src={flagUrl} size={32} /> : null}
        <span className="font-[family-name:var(--font-landing-display)] text-[20px] uppercase tracking-[0.02em] leading-none truncate text-[var(--color-landing-text)]">
          {name}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {finalScore !== null ? (
          <span
            className="font-[family-name:var(--font-landing-display)] text-[32px] tabular-nums leading-none text-[var(--color-landing-text)]"
            aria-label={`Resultado ${name}: ${finalScore}`}
          >
            {finalScore}
          </span>
        ) : null}
        <PredictionInput
          value={predictionScore}
          disabled={disabled}
          onOpenSheet={onOpenSheet}
          onChange={onChange}
          ariaLabel={ariaLabel}
        />
      </div>
    </div>
  );
}

function KickoffTime({ iso }: { iso: string }) {
  // Visualizamos hora ART (UTC-3). Mas detallado en spec §6.4
  // (formatos de fecha completos lo maneja la pagina, no la card).
  try {
    const d = new Date(iso);
    const formatter = new Intl.DateTimeFormat("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
      hour12: false,
    });
    return <>{formatter.format(d)} ART</>;
  } catch {
    return <>--:--</>;
  }
}

function Countdown({
  match,
  state,
}: {
  match: Match;
  state: MatchCardState;
}) {
  const parts = useCountdown(match.predictionsLockAt);
  const baseClass =
    "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em]";
  if (state === "finished") {
    return (
      <span className={cn(baseClass, "text-[var(--color-landing-text-muted)]")}>
        FINALIZADO
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span className={cn(baseClass, "text-[var(--color-landing-text-muted)]")}>
        CERRADO
      </span>
    );
  }
  if (!parts) {
    return (
      <span className={cn(baseClass, "text-[var(--color-landing-text-muted)]")}>
        Cierra pronto
      </span>
    );
  }
  if (parts.finished) {
    return (
      <span className={cn(baseClass, "text-[var(--color-landing-red)]")}>
        Cerrado
      </span>
    );
  }
  const label =
    parts.days > 0
      ? `${parts.days}D ${parts.hours}H`
      : parts.hours > 0
        ? `${parts.hours}H ${parts.minutes}M`
        : `${parts.minutes}M ${parts.seconds.toString().padStart(2, "0")}S`;
  return (
    <span className={cn(baseClass, "text-[var(--color-landing-text-muted)]")}>
      Cierra en {label}
    </span>
  );
}

function StateBadge({
  state,
  prediction,
}: {
  state: MatchCardState;
  prediction: Prediction | null | undefined;
}) {
  const baseClass =
    "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em]";
  if (state === "empty") {
    return (
      <span className={cn(baseClass, "text-[var(--color-landing-text-muted)]")}>
        PENDIENTE
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className={cn(baseClass, "text-[var(--color-landing-green)]")}>
        ✓ GUARDADO
      </span>
    );
  }
  if (state === "retrying") {
    return (
      <span
        className={cn(
          baseClass,
          "inline-flex items-center gap-1 text-[var(--color-landing-red)]",
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        REINTENTANDO...
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span
        className={cn(
          baseClass,
          "inline-flex items-center gap-1 text-[var(--color-landing-text-muted)]",
        )}
      >
        <Lock className="h-3 w-3" aria-hidden />
        CERRADO
      </span>
    );
  }
  // finished
  if (prediction) {
    return (
      <span
        className={cn(
          baseClass,
          prediction.pointsEarned > 0
            ? "text-[var(--color-landing-green)]"
            : "text-[var(--color-landing-text-muted)]",
        )}
      >
        {prediction.pointsEarned > 0
          ? `+${prediction.pointsEarned} PTS`
          : "0 PTS"}
      </span>
    );
  }
  return (
    <span className={cn(baseClass, "text-[var(--color-landing-text-muted)]")}>
      SIN PREDICCION
    </span>
  );
}

function FinishedSummary({
  match,
  prediction,
}: {
  match: Match;
  prediction: Prediction;
}) {
  const recentlyEvaluated =
    prediction.evaluatedAt !== null &&
    Date.now() - new Date(prediction.evaluatedAt).getTime() <
      RECENT_EVAL_WINDOW_MS;
  const showCelebration = recentlyEvaluated && prediction.pointsEarned > 0;
  const eyebrow =
    "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]";

  return (
    <div className="mt-5 pt-4 border-t border-[var(--color-landing-line)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className={eyebrow}>Resultado</span>
          {match.scoreHome !== null && match.scoreAway !== null ? (
            <ScoreDisplay
              scoreHome={match.scoreHome}
              scoreAway={match.scoreAway}
              size="sm"
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-1 text-right">
          <span className={eyebrow}>Tu prediccion</span>
          <ScoreDisplay
            scoreHome={prediction.scoreHome}
            scoreAway={prediction.scoreAway}
            size="sm"
            isPrediction
          />
        </div>
      </div>
      {showCelebration ? (
        <div className="mt-3 flex justify-end">
          <PointsCelebration points={prediction.pointsEarned} />
        </div>
      ) : null}
      {/* Hint para reintentar carga si aplicable (NO mostramos si match
          ya fue evaluado). Para retries fallidos en estado open, badge
          arriba muestra "REINTENTANDO". */}
      <button
        type="button"
        className="mt-2 inline-flex items-center gap-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)] cursor-default"
        disabled
        aria-hidden
      >
        <RefreshCw className="h-3 w-3" />
        Evaluado
      </button>
    </div>
  );
}

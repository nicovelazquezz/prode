"use client";

import { ArrowRight } from "lucide-react";
import { TeamFlag } from "@/components/domain/team-flag";
import type { Phase } from "@/lib/api/types";
import type { PreviousRoundMatch } from "@/lib/api/admin";

const PHASE_LABELS: Record<Phase, string> = {
  GROUPS: "Grupos",
  ROUND_32: "16avos",
  ROUND_16: "Octavos",
  QUARTERS: "Cuartos",
  SEMIS: "Semis",
  THIRD_PLACE: "Tercer puesto",
  FINAL: "Final",
};

interface PreviousRoundReferenceProps {
  previousPhase: Phase;
  matches: PreviousRoundMatch[];
  /**
   * Cuando el builder activo es FINAL mostramos también el perdedor de
   * cada semi (van al partido del 3er puesto). Para R16/QF/SF alcanza
   * con el ganador.
   */
  showLoser?: boolean;
}

/**
 * Referencia de "cruces previos" para R16, QF, SF y FINAL. Lista cada
 * partido de la fase anterior con score y badge de quién pasó (resuelto
 * server-side teniendo en cuenta `winnerTeamId` para empates).
 *
 * Si el match aún no está finalizado o no tiene ganador definido,
 * muestra "—" en lugar del badge — eso le dice al admin que primero
 * tiene que cerrar ese match (o cargar el ganador por penales).
 */
export function PreviousRoundReference({
  previousPhase,
  matches,
  showLoser = false,
}: PreviousRoundReferenceProps) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Resultados — {PHASE_LABELS[previousPhase]}
        </h2>
        <p className="mt-1 font-sans text-xs text-[var(--color-landing-text-muted)]">
          Ganadores de la fase anterior. Usalos como referencia para
          armar los cruces de la siguiente.
        </p>
      </div>

      <ul className="space-y-2">
        {matches.map((m) => (
          <li
            key={m.matchNumber}
            className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-3"
          >
            <div className="flex items-center justify-between font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
              <span>Partido #{m.matchNumber}</span>
              <span className="font-bold">{m.status}</span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <TeamRow team={m.homeTeam} score={m.scoreHome} align="left" />
              <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase text-[var(--color-landing-text-muted)]">
                vs
              </span>
              <TeamRow team={m.awayTeam} score={m.scoreAway} align="right" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <WinnerBadge winner={m.winner} />
              {showLoser ? <LoserBadge loser={m.loser} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TeamRow({
  team,
  score,
  align,
}: {
  team: PreviousRoundMatch["homeTeam"];
  score: number | null;
  align: "left" | "right";
}) {
  return (
    <div
      className={
        align === "left"
          ? "flex flex-1 items-center gap-2"
          : "flex flex-1 items-center justify-end gap-2 flex-row-reverse"
      }
    >
      {team ? (
        <>
          <TeamFlag fifaCode={team.name} src={team.flagUrl} size={18} />
          <span
            className={
              align === "left"
                ? "font-sans text-xs text-[var(--color-landing-text)] truncate"
                : "font-sans text-xs text-[var(--color-landing-text)] truncate text-right"
            }
          >
            {team.name}
          </span>
        </>
      ) : (
        <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
          —
        </span>
      )}
      <span className="font-[family-name:var(--font-landing-mono)] tabular-nums text-base text-[var(--color-landing-text)]">
        {score ?? "—"}
      </span>
    </div>
  );
}

function WinnerBadge({ winner }: { winner: PreviousRoundMatch["winner"] }) {
  if (!winner) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-dashed border-[var(--color-landing-line)] px-2 py-0.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
        Sin ganador
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-landing-green)] bg-[var(--color-landing-surface-2)] px-2 py-0.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)]">
      <ArrowRight className="h-3 w-3 text-[var(--color-landing-green)]" aria-hidden />
      <TeamFlag fifaCode={winner.name} src={winner.flagUrl} size={12} />
      Pasa {winner.name}
    </span>
  );
}

function LoserBadge({ loser }: { loser: PreviousRoundMatch["loser"] }) {
  if (!loser) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-landing-line)] bg-[var(--color-landing-surface-2)] px-2 py-0.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
      <TeamFlag fifaCode={loser.name} src={loser.flagUrl} size={12} />
      3er puesto: {loser.name}
    </span>
  );
}

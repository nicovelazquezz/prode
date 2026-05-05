"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScoreDisplay } from "@/components/domain/score-display";
import { TeamFlag } from "@/components/domain/team-flag";
import { queryKeys } from "@/lib/api/queryKeys";
import { getPublicProfile } from "@/lib/api/users";
import { cn } from "@/lib/utils/cn";

interface PublicProfileDrawerProps {
  /**
   * userId del jugador a mostrar. Si null, el drawer permanece
   * cerrado y la query no se ejecuta.
   */
  userId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Drawer / sheet con el perfil publico de un jugador. Muestra
 * nombre + lista de predicciones de partidos finalizados con
 * los puntos de cada una.
 *
 * Se monta desde la tabla de leaderboard al click en una row.
 * La query se habilita solo cuando `userId !== null`.
 */
export function PublicProfileDrawer({
  userId,
  onOpenChange,
}: PublicProfileDrawerProps) {
  const open = userId !== null;
  const profileQuery = useQuery({
    queryKey: userId ? queryKeys.users.publicProfile(userId) : ["users", "noop"],
    queryFn: () => {
      if (!userId) throw new Error("No userId");
      return getPublicProfile(userId);
    },
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {profileQuery.data
              ? `${profileQuery.data.firstName} ${profileQuery.data.lastName}`
              : "Perfil"}
          </SheetTitle>
          <SheetDescription>
            Predicciones de partidos finalizados.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6">
          {profileQuery.isLoading ? (
            <div
              role="status"
              aria-busy="true"
              className="flex flex-col gap-3"
            >
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-20 rounded-md bg-[var(--color-prode-surface)] animate-pulse"
                />
              ))}
            </div>
          ) : profileQuery.isError ? (
            <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
              No pudimos cargar el perfil.
            </p>
          ) : !profileQuery.data ||
            profileQuery.data.predictionsFinished.length === 0 ? (
            <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
              Aun no hay predicciones evaluadas.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Predicciones finalizadas">
              {profileQuery.data.predictionsFinished.map((p) => (
                <PredictionItem key={p.matchId} prediction={p} />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

type ItemProps = {
  prediction: {
    matchId: string;
    scoreHome: number;
    scoreAway: number;
    pointsEarned: number;
    match: {
      homeTeam: { fifaCode: string; name: string } | null;
      awayTeam: { fifaCode: string; name: string } | null;
      homeTeamLabel: string | null;
      awayTeamLabel: string | null;
      scoreHome: number | null;
      scoreAway: number | null;
    };
  };
};

function PredictionItem({ prediction: p }: ItemProps) {
  const homeName = p.match.homeTeam?.name ?? p.match.homeTeamLabel ?? "—";
  const awayName = p.match.awayTeam?.name ?? p.match.awayTeamLabel ?? "—";
  const isCorrect = p.pointsEarned > 0;

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border bg-white p-3",
        isCorrect
          ? "border-[var(--color-prode-accent)]"
          : "border-[var(--color-prode-border)]",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {p.match.homeTeam?.fifaCode ? (
          <TeamFlag fifaCode={p.match.homeTeam.fifaCode} size={20} />
        ) : null}
        <span className="font-sans text-xs uppercase tracking-wider text-[var(--color-prode-text-secondary)] truncate">
          {homeName} vs {awayName}
        </span>
        {p.match.awayTeam?.fifaCode ? (
          <TeamFlag fifaCode={p.match.awayTeam.fifaCode} size={20} />
        ) : null}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex flex-col items-end">
          <span className="font-sans text-[10px] uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Resultado
          </span>
          {p.match.scoreHome !== null && p.match.scoreAway !== null ? (
            <ScoreDisplay
              scoreHome={p.match.scoreHome}
              scoreAway={p.match.scoreAway}
              size="sm"
            />
          ) : (
            <span className="font-sans text-xs text-[var(--color-prode-text-muted)]">—</span>
          )}
        </div>
        <div className="flex flex-col items-end">
          <span className="font-sans text-[10px] uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Pred
          </span>
          <ScoreDisplay
            scoreHome={p.scoreHome}
            scoreAway={p.scoreAway}
            size="sm"
            isPrediction
          />
        </div>
        <span
          className={cn(
            "font-sans text-xs font-bold uppercase tracking-wider",
            isCorrect
              ? "text-[var(--color-prode-accent)]"
              : "text-[var(--color-prode-text-secondary)]",
          )}
        >
          {p.pointsEarned > 0 ? `+${p.pointsEarned}` : "0"} pts
        </span>
      </div>
    </li>
  );
}

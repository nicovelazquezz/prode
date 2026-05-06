"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, ChevronLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TeamFlag } from "@/components/domain/team-flag";
import { getPlayersByTeam } from "@/lib/api/players";
import { queryKeys } from "@/lib/api/queryKeys";
import { formatPlayerName } from "@/lib/landing/format-player-name";
import type { Player, Team } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

interface PlayerSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Lista completa de teams disponibles (las 48 selecciones del
   * Mundial). El usuario primero elige selección, después jugador.
   */
  teams: Team[];
  /**
   * Player seleccionado (si lo hay) para mostrar el estado activo
   * y precargar la selección de team al abrir.
   */
  selectedPlayer?: Player | null;
  onSelect: (player: Player) => void;
  /** Título accesible (ej "Elegí al goleador del torneo"). */
  title: string;
}

type Step = "team" | "player";

/**
 * Modal de selección de jugador en 2 pasos: primero team, después
 * player dentro de ese team. Esto es lo que pide el brief — el
 * listado total son ~1622 jugadores, demasiado para scrollear sin
 * filtro fuerte; filtrar por selección reduce a ~25-160 por equipo.
 *
 * Visual: misma estética stadium que TeamSelectModal — dark editorial,
 * surface-2 cards, mono labels, gold para el seleccionado.
 *
 * Se muestra el shirtNumber junto al nombre cuando está disponible
 * (ayuda a desambiguar nombres repetidos). El nombre se reformatea
 * "Apellido Nombre" → "Nombre Apellido" via `formatPlayerName`.
 */
export function PlayerSelectModal({
  open,
  onOpenChange,
  teams,
  selectedPlayer,
  onSelect,
  title,
}: PlayerSelectModalProps) {
  const [step, setStep] = useState<Step>(
    selectedPlayer?.teamId ? "player" : "team",
  );
  const [activeTeamId, setActiveTeamId] = useState<string | null>(
    selectedPlayer?.teamId ?? null,
  );
  const [teamQuery, setTeamQuery] = useState("");
  const [playerQuery, setPlayerQuery] = useState("");

  const playersQuery = useQuery({
    queryKey: queryKeys.players.byTeam(activeTeamId ?? ""),
    queryFn: () => getPlayersByTeam(activeTeamId!),
    enabled: !!activeTeamId && open,
    staleTime: 5 * 60_000,
  });

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId],
  );

  // Filtrado teams (step 1)
  const teamsFiltered = useMemo(() => {
    const q = teamQuery.trim().toLowerCase();
    const filtered = q
      ? teams.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.fifaCode.toLowerCase().includes(q),
        )
      : teams;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [teams, teamQuery]);

  // Filtrado players (step 2)
  const playersSorted = useMemo(() => {
    const list = playersQuery.data ?? [];
    const q = playerQuery.trim().toLowerCase();
    const filtered = q
      ? list.filter((p) => p.fullName.toLowerCase().includes(q))
      : list;
    // Orden alfabético por display name (Nombre Apellido).
    return [...filtered].sort((a, b) =>
      formatPlayerName(a.fullName).localeCompare(formatPlayerName(b.fullName)),
    );
  }, [playersQuery.data, playerQuery]);

  const handleClose = (next: boolean) => {
    if (!next) {
      // Al cerrar volvemos al step de team para la próxima apertura.
      setTeamQuery("");
      setPlayerQuery("");
    }
    onOpenChange(next);
  };

  const goBackToTeams = () => {
    setStep("team");
    setPlayerQuery("");
  };

  const pickTeam = (team: Team) => {
    setActiveTeamId(team.id);
    setStep("player");
  };

  const pickPlayer = (player: Player) => {
    onSelect(player);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center gap-2">
          {step === "player" ? (
            <button
              type="button"
              onClick={goBackToTeams}
              aria-label="Volver a selecciones"
              className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded-sm text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          <DialogTitle className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
            {step === "team" ? title : `Plantel · ${activeTeam?.name ?? ""}`}
          </DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          {step === "team"
            ? "Primero elegí la selección, después el jugador."
            : "Buscá o seleccioná un jugador del plantel."}
        </DialogDescription>

        {step === "team" ? (
          <TeamStep
            teams={teamsFiltered}
            query={teamQuery}
            setQuery={setTeamQuery}
            selectedTeamId={activeTeamId}
            onPick={pickTeam}
          />
        ) : (
          <PlayerStep
            team={activeTeam}
            players={playersSorted}
            loading={playersQuery.isLoading}
            errored={playersQuery.isError}
            query={playerQuery}
            setQuery={setPlayerQuery}
            selectedPlayerId={selectedPlayer?.id ?? null}
            onPick={pickPlayer}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Step 1: pick team ───────────────────────────────────────────

function TeamStep({
  teams,
  query,
  setQuery,
  selectedTeamId,
  onPick,
}: {
  teams: Team[];
  query: string;
  setQuery: (q: string) => void;
  selectedTeamId: string | null;
  onPick: (team: Team) => void;
}) {
  return (
    <>
      <SearchInput
        query={query}
        onChange={setQuery}
        placeholder="Buscar país o código..."
      />
      <div className="flex-1 overflow-y-auto -mx-4 px-4 mt-3">
        {teams.length === 0 ? (
          <EmptyMono text="No encontramos selecciones con ese nombre." />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {teams.map((t) => {
              const isSelected = selectedTeamId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPick(t)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-sm p-3",
                    "border-2 transition-colors duration-200 cursor-pointer",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-landing-gold)]",
                    isSelected
                      ? "border-[var(--color-landing-gold)] bg-[var(--color-landing-surface-2)]"
                      : "border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] hover:border-[var(--color-landing-text)]",
                  )}
                >
                  <TeamFlag fifaCode={t.fifaCode} src={t.flagUrl} size={40} />
                  <span className="font-[family-name:var(--font-landing-display)] text-sm uppercase tracking-tight leading-tight text-center line-clamp-2 text-[var(--color-landing-text)]">
                    {t.name}
                  </span>
                  <span className="font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
                    {t.fifaCode}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Step 2: pick player ─────────────────────────────────────────

function PlayerStep({
  team,
  players,
  loading,
  errored,
  query,
  setQuery,
  selectedPlayerId,
  onPick,
}: {
  team: Team | null;
  players: Player[];
  loading: boolean;
  errored: boolean;
  query: string;
  setQuery: (q: string) => void;
  selectedPlayerId: string | null;
  onPick: (player: Player) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3 border-b border-[var(--color-landing-line-strong)] pb-3 pt-1">
        {team ? <TeamFlag fifaCode={team.fifaCode} src={team.flagUrl} size={28} /> : null}
        <SearchInput
          query={query}
          onChange={setQuery}
          placeholder={`Buscar jugador de ${team?.shortName ?? "la selección"}...`}
          flat
        />
      </div>

      <div className="flex-1 overflow-y-auto -mx-4 px-4 mt-3">
        {loading ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-2">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="h-12 rounded-sm bg-[var(--color-landing-surface-2)]/60 animate-pulse"
              />
            ))}
          </div>
        ) : errored ? (
          <EmptyMono text="Lista de jugadores no disponible aún. Probá más tarde." />
        ) : players.length === 0 ? (
          <EmptyMono text="No encontramos jugadores que coincidan." />
        ) : (
          <ul className="flex flex-col gap-1">
            {players.map((p) => {
              const isSelected = selectedPlayerId === p.id;
              const display = formatPlayerName(p.fullName);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p)}
                    aria-pressed={isSelected}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 rounded-sm px-3 py-2.5 text-left",
                      "border transition-colors duration-200 cursor-pointer",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-landing-gold)]",
                      isSelected
                        ? "border-[var(--color-landing-gold)] bg-[var(--color-landing-surface-2)]"
                        : "border-[var(--color-landing-line)] bg-transparent hover:border-[var(--color-landing-line-strong)] hover:bg-[var(--color-landing-surface)]",
                    )}
                  >
                    <span className="font-[family-name:var(--font-landing-display)] text-base uppercase tracking-tight truncate text-[var(--color-landing-text)]">
                      {display}
                    </span>
                    <ShirtBadge number={p.shirtNumber} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function ShirtBadge({ number }: { number: number | null }) {
  if (number === null || number === undefined) {
    return (
      <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[var(--color-landing-line-strong)] font-[family-name:var(--font-landing-mono)] text-[10px] text-[var(--color-landing-text-muted)]">
        —
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-landing-surface-2)] border border-[var(--color-landing-line-strong)] font-[family-name:var(--font-landing-mono)] text-[11px] font-bold tabular-nums text-[var(--color-landing-gold)]">
      {number}
    </span>
  );
}

function SearchInput({
  query,
  onChange,
  placeholder,
  flat = false,
}: {
  query: string;
  onChange: (q: string) => void;
  placeholder: string;
  flat?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        !flat && "border-b border-[var(--color-landing-line-strong)] pb-3 pt-1",
        flat && "flex-1",
      )}
    >
      <Search
        className="h-4 w-4 shrink-0 text-[var(--color-landing-text-muted)]"
        aria-hidden
      />
      <input
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex h-10 w-full bg-transparent text-base text-[var(--color-landing-text)] outline-none placeholder:text-[var(--color-landing-text-muted)]"
        autoFocus
      />
      {query ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpiar búsqueda"
          className="text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)]"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function EmptyMono({ text }: { text: string }) {
  return (
    <p className="py-8 text-center font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
      {text}
    </p>
  );
}

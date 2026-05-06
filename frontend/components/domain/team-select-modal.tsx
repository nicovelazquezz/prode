"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TeamFlag } from "@/components/domain/team-flag";
import type { Team } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

interface TeamSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Lista completa de teams disponibles para seleccionar.
   */
  teams: Team[];
  /**
   * IDs de teams ya elegidos en otros campos. Se renderizan disabled
   * con un badge "Ya elegido". El team actualmente seleccionado se
   * pasa via `selectedTeamId` aparte para que NO quede disabled.
   */
  excludeTeamIds?: string[];
  /**
   * Team seleccionado en este campo (para indicar visualmente).
   */
  selectedTeamId?: string | null;
  onSelect: (team: Team) => void;
  /**
   * Titulo accesible (ej "Elegi al campeon").
   */
  title: string;
}

/**
 * Modal de seleccion de team usado por /especiales (campeon, subcampeon,
 * tercer puesto). Spec §6.7.
 *
 * Visual: dark editorial. Card por team con bg surface-2 y line-strong;
 * estado seleccionado → border gold; estado excluido → opacity reducido
 * con badge mono uppercase.
 */
export function TeamSelectModal({
  open,
  onOpenChange,
  teams,
  excludeTeamIds = [],
  selectedTeamId,
  onSelect,
  title,
}: TeamSelectModalProps) {
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? teams.filter(
        (t) =>
          t.name.toLowerCase().includes(normalizedQuery) ||
          t.fifaCode.toLowerCase().includes(normalizedQuery),
      )
    : teams;

  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogTitle className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          {title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Buscador y grilla de seleccionados.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b border-[var(--color-landing-line-strong)] pb-3 pt-1">
          <Search
            className="h-4 w-4 shrink-0 text-[var(--color-landing-text-muted)]"
            aria-hidden
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar país o código..."
            className="flex h-10 w-full bg-transparent text-base text-[var(--color-landing-text)] outline-none placeholder:text-[var(--color-landing-text-muted)]"
            autoFocus
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpiar busqueda"
              className="text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto -mx-4 px-4 mt-3">
          {sorted.length === 0 ? (
            <p className="py-8 text-center font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
              No encontramos teams con ese nombre.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {sorted.map((t) => {
                const isExcluded = excludeTeamIds.includes(t.id);
                const isSelected = selectedTeamId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (isExcluded) return;
                      onSelect(t);
                      onOpenChange(false);
                    }}
                    disabled={isExcluded}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-sm p-3",
                      "border-2 transition-colors duration-200",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-landing-gold)]",
                      isSelected
                        ? "border-[var(--color-landing-gold)] bg-[var(--color-landing-surface-2)]"
                        : isExcluded
                          ? "border-[var(--color-landing-line)] bg-[var(--color-landing-surface)] opacity-40 cursor-not-allowed"
                          : "border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] hover:border-[var(--color-landing-text)]",
                    )}
                  >
                    <TeamFlag fifaCode={t.fifaCode} src={t.flagUrl} size={40} />
                    <span
                      className={cn(
                        "font-[family-name:var(--font-landing-display)] text-sm uppercase tracking-tight leading-tight text-center line-clamp-2",
                        isExcluded
                          ? "text-[var(--color-landing-text-muted)]"
                          : "text-[var(--color-landing-text)]",
                      )}
                    >
                      {t.name}
                    </span>
                    <span className="font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
                      {t.fifaCode}
                    </span>
                    {isExcluded ? (
                      <span className="font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
                        Ya elegido
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

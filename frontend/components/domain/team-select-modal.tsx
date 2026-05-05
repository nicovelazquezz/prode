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
 * tercer puesto). Spec §6.7. Implementacion:
 *
 * - Mobile: full-width / casi full-screen.
 * - Desktop: dialog centrado max-w-2xl.
 * - Grid 4 cols (mobile) / 6 cols (desktop) de cards con bandera +
 *   nombre + codigo FIFA.
 * - Search input arriba que filtra por name / code (case-insensitive).
 * - Teams en `excludeTeamIds` quedan disabled con visual atenuado.
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
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Buscador y grilla de seleccionados.
        </DialogDescription>

        {/* Search */}
        <div className="flex items-center gap-2 border-b border-[var(--color-prode-border)] pb-2">
          <Search className="h-4 w-4 shrink-0 text-[var(--color-prode-text-secondary)]" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar pais o codigo..."
            className="flex h-10 w-full bg-transparent font-sans text-base outline-none placeholder:text-[var(--color-prode-text-muted)]"
            autoFocus
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpiar busqueda"
              className="text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)]"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto -mx-4 px-4 mt-3">
          {sorted.length === 0 ? (
            <p className="py-8 text-center font-sans text-sm text-[var(--color-prode-text-secondary)]">
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
                      "flex flex-col items-center gap-1 rounded-md p-3",
                      "border-2 transition-colors duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-offset-1",
                      isSelected
                        ? "border-[var(--color-prode-accent)] bg-[var(--color-prode-surface)]"
                        : isExcluded
                          ? "border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] cursor-not-allowed"
                          : "border-[var(--color-prode-border)] bg-white hover:border-[var(--color-prode-near-black)]",
                    )}
                  >
                    <TeamFlag fifaCode={t.fifaCode} size={40} />
                    <span
                      className={cn(
                        "font-display text-sm font-black uppercase tracking-wide leading-tight text-center line-clamp-2",
                        isExcluded
                          ? "text-[var(--color-prode-text-muted)]"
                          : "text-[var(--color-prode-near-black)]",
                      )}
                    >
                      {t.name}
                    </span>
                    <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
                      {t.fifaCode}
                    </span>
                    {isExcluded ? (
                      <span className="font-sans text-[9px] font-bold uppercase tracking-wider text-[var(--color-prode-text-muted)]">
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

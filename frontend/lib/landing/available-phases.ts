import type { Match, Phase } from "@/lib/api/types";

/**
 * Orden canónico de las fases del Mundial. Se usa para preservar
 * el orden visual de los tabs cuando se derivan dinámicamente.
 */
export const PHASE_ORDER: Phase[] = [
  "GROUPS",
  "ROUND_32",
  "ROUND_16",
  "QUARTERS",
  "SEMIS",
  "THIRD_PLACE",
  "FINAL",
];

export const PHASE_LABEL: Record<Phase, string> = {
  GROUPS: "Grupos",
  ROUND_32: "16avos",
  ROUND_16: "Octavos",
  QUARTERS: "Cuartos",
  SEMIS: "Semis",
  THIRD_PLACE: "3er puesto",
  FINAL: "Final",
};

/**
 * Devuelve solo las fases que tienen al menos un match en la lista.
 * El admin va creando matches fase por fase a medida que avanza el
 * Mundial, así que la presencia de un match en una fase indica que
 * esa fase ya está habilitada para predecir.
 *
 * Si la lista de matches está vacía (o pasa undefined), devolvemos
 * solo `GROUPS` como fallback razonable.
 */
export function deriveAvailablePhases(matches: Match[] | undefined): Phase[] {
  if (!matches || matches.length === 0) return ["GROUPS"];
  const present = new Set<Phase>();
  for (const m of matches) {
    present.add(m.phase);
  }
  return PHASE_ORDER.filter((p) => present.has(p));
}

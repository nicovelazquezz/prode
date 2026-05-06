import { api } from "./client";
import type { Player } from "./types";

/**
 * Lista jugadores. El uso principal hoy es el picker de top scorer
 * en /especiales — el flujo del usuario es:
 *   1. Elegir selección (team).
 *   2. Buscar/scrollear el plantel de esa selección.
 *
 * Por eso la firma acepta `teamId` como filtro principal. El backend
 * de la fuente flashscore mantiene la lista extendida de convocados
 * (~25-160 por selección), no la plantilla oficial FIFA — esa se
 * confirma ~1 mes antes del torneo.
 *
 * Cuando el endpoint todavía no esté disponible en el backend, este
 * fetch responderá 404 / network error; el caller debe manejarlo
 * (TanStack Query `isError` → mostrar fallback "lista no disponible").
 */
export async function getPlayersByTeam(teamId: string): Promise<Player[]> {
  return api
    .get("players", { searchParams: { teamId } })
    .json<Player[]>();
}

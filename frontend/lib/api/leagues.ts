import { api } from "./client";
import type { League } from "./types";

/**
 * Multi-prode v1.1: las memberships de mini-liga ahora son por
 * `entryId` (no por `userId`). Un user con 2 entries puede unirse
 * a la misma liga con ambos prodes (rows separados en la tabla).
 *
 * El backend valida que el `entryId` pertenezca al user autenticado.
 */

export async function getMyLeagues(): Promise<League[]> {
  return api.get("leagues/me").json<League[]>();
}

export async function createLeague(dto: {
  name: string;
  description?: string;
  isPublic?: boolean;
  maxMembers?: number;
  /**
   * Entry que se autoinscribe a la liga al crearla. Required en
   * multi-prode; el frontend lo deriva del activeEntry o del picker
   * cuando user tiene >1.
   */
  entryId: string;
}): Promise<League> {
  return api.post("leagues", { json: dto }).json<League>();
}

export async function joinLeague(dto: {
  inviteCode: string;
  entryId: string;
}): Promise<League> {
  return api.post("leagues/join", { json: dto }).json<League>();
}

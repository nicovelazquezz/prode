import { api } from "./client";
import type { League } from "./types";

export async function getMyLeagues(): Promise<League[]> {
  return api.get("leagues/me").json<League[]>();
}

export async function createLeague(dto: {
  name: string;
  description?: string;
  isPublic?: boolean;
  maxMembers?: number;
}): Promise<League> {
  return api.post("leagues", { json: dto }).json<League>();
}

export async function joinLeague(dto: {
  inviteCode: string;
}): Promise<League> {
  return api.post("leagues/join", { json: dto }).json<League>();
}

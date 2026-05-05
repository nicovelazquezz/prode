import { api } from "./client";
import type { PublicStats } from "./types";

export async function getPublicStats(): Promise<PublicStats> {
  return api.get("stats/public").json<PublicStats>();
}

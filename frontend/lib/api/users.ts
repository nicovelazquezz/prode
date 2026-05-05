import { api } from "./client";
import type { PublicProfile } from "./types";

export async function getPublicProfile(
  userId: string,
): Promise<PublicProfile> {
  return api.get(`users/${userId}/public-profile`).json<PublicProfile>();
}

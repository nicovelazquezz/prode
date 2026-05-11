import { api } from "./client";
import type { PublicProfile, User } from "./types";

export async function getPublicProfile(
  userId: string,
): Promise<PublicProfile> {
  return api.get(`users/${userId}/public-profile`).json<PublicProfile>();
}

/**
 * PATCH /users/me — el user edita campos editables de su perfil.
 * Todos los campos son opcionales; el backend aplica solo los provistos.
 *
 * Validaciones (espejo del DTO backend):
 *   - firstName/lastName: regex letras + espacios + tildes + ñ + apóstrofe
 *     + guión, mín 2 chars, máx 100.
 *   - whatsapp: 10-15 dígitos sin signos (E.164-ish, igual que registration).
 *   - whatsappOptIn: bool simple.
 *
 * Devuelve el User actualizado. El frontend debe llamar a `refresh()`
 * del AuthProvider para sincronizar el estado del header (saludo, etc.)
 * — ese flow ya existe en useAuth.
 */
export interface UpdateMeDto {
  firstName?: string;
  lastName?: string;
  whatsapp?: string;
  whatsappOptIn?: boolean;
}

export async function updateMe(dto: UpdateMeDto): Promise<User> {
  return api.patch("users/me", { json: dto }).json<User>();
}

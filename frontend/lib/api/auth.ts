import { api } from "./client";
import { tokenStore } from "../auth/token-store";
import type { AuthResponse, User } from "./types";

/**
 * Login con DNI + password. Backend setea cookies httpOnly
 * (`refresh_token`) + cookie hint `has_session`. Frontend guarda
 * el accessToken en `tokenStore`.
 */
export async function login(dto: {
  dni: string;
  password: string;
}): Promise<AuthResponse> {
  const data = await api.post("auth/login", { json: dto }).json<AuthResponse>();
  tokenStore.set(data.accessToken);
  return data;
}

/**
 * Logout: revoca refresh server-side y limpia el access in-memory.
 * No throw si el server-side falla — el cliente siempre debe
 * limpiar local state.
 */
export async function logout(): Promise<void> {
  try {
    await api.post("auth/logout");
  } catch {
    // ignored — limpiamos local de todas formas
  }
  tokenStore.clear();
}

/**
 * Devuelve el user del JWT actual.
 */
export async function getMe(): Promise<User> {
  return api.get("auth/me").json<User>();
}

/**
 * POST /auth/refresh — re-emite access + rota refresh cookie.
 * Generalmente no se llama directo; el `refresh-interceptor` lo
 * dispara via singleton al ver un 401. Expuesto aqui para casos
 * en los que el AuthProvider quiera refrescar manualmente.
 */
export async function refresh(): Promise<AuthResponse> {
  const data = await api.post("auth/refresh").json<AuthResponse>();
  tokenStore.set(data.accessToken);
  return data;
}

export async function completeRegistration(dto: {
  token: string;
  dni: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  password: string;
}): Promise<AuthResponse> {
  const data = await api
    .post("auth/complete-registration", { json: dto })
    .json<AuthResponse>();
  tokenStore.set(data.accessToken);
  return data;
}

export async function forgotPassword(dto: {
  dni: string;
}): Promise<{ ok: true }> {
  return api
    .post("auth/forgot-password", { json: dto })
    .json<{ ok: true }>();
}

export async function resetPassword(dto: {
  token: string;
  newPassword: string;
}): Promise<{ ok: true }> {
  return api.post("auth/reset-password", { json: dto }).json<{ ok: true }>();
}

export async function changePassword(dto: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await api.post("auth/change-password", { json: dto });
}

import "client-only";
import ky from "ky";
import { tokenStore } from "./token-store";

/**
 * Singleton dedupe del refresh: cuando N requests fallan con 401
 * simultaneamente (caso tipico al volver de background tab), todos
 * esperan la misma `Promise<string | null>` pendiente.
 *
 * Sin esto, N refresh requests paralelos rotan el token N veces
 * (race condition) y todos menos uno fallan con 401 nuevamente.
 */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Permite override del cliente ky en tests (MSW). En runtime usa
 * el ky base con `prefixUrl` y `credentials: 'include'`.
 */
const createDefaultClient = () =>
  ky.create({
    // ky v2 renamed `prefixUrl` to `prefix` (and added `baseUrl`).
    // We use `prefix` because our inputs are bare paths like "auth/refresh".
    prefix: process.env.NEXT_PUBLIC_API_URL,
    credentials: "include",
  });

let refreshClient: typeof ky = createDefaultClient();

/**
 * Internal: setter para tests que necesitan inyectar un ky custom
 * (e.g. apuntando a un MSW server). En produccion no se usa.
 */
export function __setRefreshClientForTests(client: typeof ky): void {
  refreshClient = client;
}

export function __resetRefreshClientForTests(): void {
  refreshClient = createDefaultClient();
}

/**
 * Test helper: limpia la promesa pendiente entre tests.
 */
export function __resetRefreshPromiseForTests(): void {
  refreshPromise = null;
}

/**
 * Hace POST /auth/refresh (la cookie httpOnly viaja automatica via
 * `credentials: 'include'`) y guarda el nuevo accessToken en el
 * tokenStore. Si falla, clear del store y null retornado.
 *
 * Multiples llamadas concurrentes comparten la MISMA promesa
 * (Object.is identity). Por eso la funcion NO es `async` —
 * un `async function` siempre retorna un Promise *nuevo* envolviendo
 * el valor, lo cual romperia la dedupe por referencia.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = refreshClient
    .post("auth/refresh")
    .json<{ accessToken: string }>()
    .then(({ accessToken }) => {
      tokenStore.set(accessToken);
      return accessToken as string | null;
    })
    .catch(() => {
      tokenStore.clear();
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

import "client-only";
import ky, { type KyInstance } from "ky";
import { tokenStore } from "../auth/token-store";
import { refreshAccessToken } from "../auth/refresh-interceptor";

/**
 * Cliente HTTP unico para todas las requests al backend.
 *
 * Hooks (ky v2 — los hooks reciben un state object `{ request, options,
 * response?, retryCount }`):
 *  - `beforeRequest`: agrega `Authorization: Bearer <token>` si hay
 *    token en el store.
 *  - `afterResponse`: si el response es 401 (y NO es la propia
 *    request a /auth/refresh, ni un retry previo marcado con
 *    `X-Retried: 1`), llama al singleton `refreshAccessToken()`,
 *    reintenta UNA vez con el token nuevo; si el refresh falla,
 *    redirect a /login.
 *
 * El header `X-Retried` previene loops infinitos: si tras refresh
 * el reintento tambien devuelve 401 (caso edge: token rotado pero
 * server-side el user fue baneado), no reintentamos otra vez.
 */
function buildClient(): KyInstance {
  return ky.create({
    prefix: process.env.NEXT_PUBLIC_API_URL,
    credentials: "include",
    hooks: {
      beforeRequest: [
        ({ request }) => {
          const token = tokenStore.get();
          if (token) request.headers.set("Authorization", `Bearer ${token}`);
        },
      ],
      afterResponse: [
        async ({ request, response }) => {
          if (response.status !== 401) return response;

          const isRefreshCall = request.url.includes("/auth/refresh");
          const alreadyRetried = request.headers.get("X-Retried") === "1";
          if (isRefreshCall || alreadyRetried) return response;

          const refreshed = await refreshAccessToken();

          if (!refreshed) {
            if (typeof window !== "undefined") {
              // Capturamos la URL actual para que después del login
              // el user vuelva a donde estaba (no al inicio).
              // Saltamos páginas públicas para evitar loops:
              // /login → /login?returnTo=/login no tiene sentido.
              const here =
                window.location.pathname + window.location.search;
              const isPublicPath =
                here === "/" ||
                here.startsWith("/login") ||
                here.startsWith("/registro") ||
                here.startsWith("/forgot-password") ||
                here.startsWith("/reset-password") ||
                here.startsWith("/inscripcion") ||
                here.startsWith("/completar-registro");
              const target = isPublicPath
                ? "/login"
                : `/login?returnTo=${encodeURIComponent(here)}`;
              window.location.href = target;
            }
            return response;
          }

          // Reintento UNA vez con token nuevo + flag X-Retried.
          // Construimos un nuevo Request porque las cabeceras del
          // original ya fueron consumidas por el fetch fallido.
          const retryHeaders = new Headers(request.headers);
          retryHeaders.set("Authorization", `Bearer ${refreshed}`);
          retryHeaders.set("X-Retried", "1");
          const retryRequest = new Request(request, { headers: retryHeaders });
          return ky(retryRequest);
        },
      ],
    },
  });
}

/**
 * Construccion perezoso (lazy) — se construye en el primer acceso.
 * Esto permite que `process.env.NEXT_PUBLIC_API_URL` se resuelva
 * cuando el test/entorno ya esta configurado, no en module init time.
 *
 * En produccion (Next.js inlinea NEXT_PUBLIC_*), la diferencia es
 * imperceptible.
 */
let _api: KyInstance | null = null;
function getApi(): KyInstance {
  if (!_api) _api = buildClient();
  return _api;
}

/**
 * Test-only: invalida el client cacheado para que el proximo
 * acceso lo reconstruya con el env actualizado.
 */
export function __resetApiClientForTests(): void {
  _api = null;
}

/**
 * Proxy que delega al cliente lazy. Las propiedades/metodos de ky
 * son accedidas via Reflect, asi `api.get(...)`, `api.post(...)`,
 * etc. funcionan idempotentes.
 */
export const api = new Proxy({} as KyInstance, {
  get(_target, prop, receiver) {
    return Reflect.get(getApi(), prop, receiver);
  },
  apply(_target, thisArg, args) {
    return Reflect.apply(
      getApi() as unknown as (...a: unknown[]) => unknown,
      thisArg,
      args,
    );
  },
}) as KyInstance;

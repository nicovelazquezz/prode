import "client-only";

/**
 * Access token store. Lives ONLY in JS module-scope (memoria),
 * jamas en localStorage/sessionStorage. Cleared en logout y refresh fail.
 *
 * `import "client-only"` (paquete oficial) hace que el bundler tire
 * error de build si un Server Component lo importa — porque las
 * variables de modulo en RSC son compartidas entre requests del
 * servidor (cross-user leak critico).
 */
let accessToken: string | null = null;

export const tokenStore = {
  get: (): string | null => accessToken,
  set: (token: string | null): void => {
    accessToken = token;
  },
  clear: (): void => {
    accessToken = null;
  },
};

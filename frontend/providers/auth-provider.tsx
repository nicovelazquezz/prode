"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { tokenStore } from "@/lib/auth/token-store";
import { refreshAccessToken } from "@/lib/auth/refresh-interceptor";
import * as authApi from "@/lib/api/auth";
import type { User } from "@/lib/api/types";

export interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  /**
   * Login con DNI + password. Despues del exito, `user` queda
   * disponible en el contexto. Errores se rethrow para que la
   * UI los maneje (toast, form errors).
   */
  login: (dto: { dni: string; password: string }) => Promise<User>;
  /**
   * Cierra sesion server-side y limpia el state local.
   * Siempre clarea el state local, aunque el backend falle.
   */
  logout: () => Promise<void>;
  /**
   * Fuerza un refresh manual (raro — el interceptor 401 ya maneja
   * el caso comun). Util si el AuthProvider quiere re-confirmar
   * que la sesion sigue activa.
   */
  refresh: () => Promise<User | null>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Lee el valor de la cookie `has_session` (no-httpOnly, set por el
 * backend cuando emite el refresh). Si el cookie esta presente,
 * vale la pena intentar `/auth/refresh`. Si no, somos un visitante
 * anonimo y evitamos el roundtrip.
 *
 * Si `document` no esta definido (SSR), retorna false.
 */
function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .map((c) => c.trim())
    .some((c) => c.startsWith("has_session=") && c !== "has_session=");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // Guarda contra doble-mount en React Strict Mode: el bootstrap solo
  // debe correr una vez (sino: dos refresh en paralelo, la singleton
  // los dedupea pero igualmente queremos un setIsLoading limpio).
  const bootstrappedRef = useRef(false);

  const refresh = useCallback(async (): Promise<User | null> => {
    const newToken = await refreshAccessToken();
    if (!newToken) {
      setUser(null);
      return null;
    }
    try {
      const me = await authApi.getMe();
      setUser(me);
      return me;
    } catch {
      tokenStore.clear();
      setUser(null);
      return null;
    }
  }, []);

  // Bootstrap: en mount, si hay cookie hint, intenta refresh+getMe.
  // Si no hay cookie, no pega al backend (visitante anonimo).
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    let cancelled = false;

    const run = async () => {
      if (!hasSessionHint()) {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      const me = await refresh();
      if (cancelled) return;
      // `refresh()` ya seteo user (o null); solo cerramos loading.
      void me;
      setIsLoading(false);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(
    async (dto: { dni: string; password: string }): Promise<User> => {
      const data = await authApi.login(dto);
      setUser(data.user);
      return data.user;
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, login, logout, refresh }),
    [user, isLoading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

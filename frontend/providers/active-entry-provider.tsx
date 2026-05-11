"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyEntries } from "@/lib/api/entries";
import { queryKeys } from "@/lib/api/queryKeys";
import { useAuth } from "@/lib/hooks/use-auth";
import type { EntrySummary } from "@/lib/api/types";

const STORAGE_KEY = "prode.activeEntryId";
/**
 * Cap default mientras no tengamos el valor real del backend
 * (`AppConfig.max_entries_per_user`). Se usa solo para deshabilitar
 * el CTA "Crear otro" cuando ya alcanzaste el cap. El backend hace la
 * validación real con `SELECT FOR UPDATE` en `POST /entries/init-payment`.
 */
const DEFAULT_MAX_ENTRIES = 5;

export interface ActiveEntryContextValue {
  entries: EntrySummary[];
  activeEntry: EntrySummary | null;
  setActiveEntry: (entryId: string) => void;
  isLoading: boolean;
  canCreateMore: boolean;
}

export const ActiveEntryContext =
  createContext<ActiveEntryContextValue | null>(null);

/**
 * Provider del entry activo. Spec §5.1 + §5.6.
 *
 * Precedencia al resolver el activeEntry en mount/re-mount:
 *   1. Query param `?entry=<id>` si existe en la lista de
 *      `/entries/me` (deep links / share). NO sobrescribe localStorage
 *      — el query param es temporal por sesión.
 *   2. `localStorage["prode.activeEntryId"]` si existe y es válido.
 *   3. Entry con menor `position` (fallback determinístico).
 *
 * Cuando el user cambia el activeEntry via `setActiveEntry()`:
 *   - Persiste en localStorage
 *   - Invalida `entries.*` y `leaderboard.aroundEntry(...)` para
 *     forzar refetch de las queries dependientes del entry
 *
 * Si el `entryId` resuelto no existe en la lista (entry borrada,
 * BD reseteada en dev): cae al menor position y limpia localStorage
 * para evitar loops.
 *
 * Si el user no está autenticado: el provider mantiene `entries=[]` y
 * `activeEntry=null`. No hace fetch — el `enabled` del useQuery
 * depende de `user`. El `(app)/layout` ya redirige a /login en ese
 * caso, así que en práctica los consumers nunca ven `activeEntry=null`
 * mientras la app está montada.
 */
export function ActiveEntryProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [activeEntryId, setActiveEntryIdState] = useState<string | null>(null);

  const entriesQuery = useQuery({
    queryKey: queryKeys.entries.me(),
    queryFn: () => getMyEntries(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const entries = entriesQuery.data ?? [];

  // Resuelve el activeEntryId siguiendo la precedencia spec §5.6.
  useEffect(() => {
    if (!entries.length) {
      // No hay entries todavía (loading o user nuevo sin pago):
      // mantener activeEntryId = null.
      if (activeEntryId !== null) setActiveEntryIdState(null);
      return;
    }

    // 1. URL query param ?entry=<id>
    const queryEntryId = searchParams?.get("entry") ?? null;
    if (queryEntryId && entries.some((e) => e.id === queryEntryId)) {
      if (activeEntryId !== queryEntryId) setActiveEntryIdState(queryEntryId);
      return;
    }

    // Si ya hay un activeEntryId válido en state, no recalcular.
    if (activeEntryId && entries.some((e) => e.id === activeEntryId)) return;

    // 2. localStorage
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && entries.some((e) => e.id === stored)) {
        setActiveEntryIdState(stored);
        return;
      }
      // Limpiar valor stale (entry no existe más).
      if (stored) window.localStorage.removeItem(STORAGE_KEY);
    }

    // 3. Fallback: entry con menor position
    const fallback = [...entries].sort((a, b) => a.position - b.position)[0];
    if (fallback) {
      setActiveEntryIdState(fallback.id);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, fallback.id);
      }
    }
    // pathname está en deps para re-resolver si cambia la ruta —
    // hace que `?entry=` deep-link se aplique al navegar entre páginas.
  }, [entries, searchParams, pathname, activeEntryId]);

  const setActiveEntry = useCallback(
    (entryId: string) => {
      if (entryId === activeEntryId) return;
      setActiveEntryIdState(entryId);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, entryId);
      }
      // Invalidar caches per-entry. Las queries globales (leaderboard
      // global/phase/league) NO se invalidan — son agnósticas al entry.
      queryClient.invalidateQueries({ queryKey: queryKeys.entries.all() });
      queryClient.invalidateQueries({ queryKey: ["leaderboard", "entry"] });
    },
    [activeEntryId, queryClient],
  );

  const activeEntry = useMemo(
    () => entries.find((e) => e.id === activeEntryId) ?? null,
    [entries, activeEntryId],
  );

  const canCreateMore = entries.length < DEFAULT_MAX_ENTRIES;

  // isLoading: cubre auth bootstrap + fetch inicial de /entries/me.
  // No incluye refetch background — los consumers leen `activeEntry`
  // y un valor presente significa "listo para renderizar".
  const isLoading =
    authLoading || (!!user && entriesQuery.isLoading);

  const value = useMemo<ActiveEntryContextValue>(
    () => ({
      entries,
      activeEntry,
      setActiveEntry,
      isLoading,
      canCreateMore,
    }),
    [entries, activeEntry, setActiveEntry, isLoading, canCreateMore],
  );

  return (
    <ActiveEntryContext.Provider value={value}>
      {children}
    </ActiveEntryContext.Provider>
  );
}

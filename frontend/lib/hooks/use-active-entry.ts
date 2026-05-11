"use client";

import { useContext } from "react";
import {
  ActiveEntryContext,
  type ActiveEntryContextValue,
} from "@/providers/active-entry-provider";

/**
 * Hook consumer del ActiveEntryContext. Throw si se usa fuera del
 * `<ActiveEntryProvider>` (signal de bug, no estado normal).
 *
 * Patrón de uso típico en páginas:
 *
 *   const { activeEntry } = useActiveEntry();
 *   const q = useQuery({
 *     queryKey: queryKeys.entries.predictions(activeEntry?.id ?? ""),
 *     queryFn: () => getEntryPredictions(activeEntry!.id),
 *     enabled: !!activeEntry,
 *   });
 *
 * Mientras `activeEntry === null` (auth bootstrap o user sin entries),
 * `enabled: false` evita disparar queries con entryId vacío.
 */
export function useActiveEntry(): ActiveEntryContextValue {
  const ctx = useContext(ActiveEntryContext);
  if (!ctx) {
    throw new Error(
      "useActiveEntry must be used within an <ActiveEntryProvider>. Wrap your tree in providers/active-entry-provider.tsx.",
    );
  }
  return ctx;
}

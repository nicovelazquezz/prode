"use client";

import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Defaults globales (spec §8.1):
 *  - `staleTime: 30s` — la mayoria de queries dejan de ser "fresh"
 *    rapido. staleTime mas alto se setea per-query via override.
 *  - `gcTime: 5min` — cuanto tiempo queda en cache sin observers.
 *  - `retry`: NO retry para 401/404 (no van a volverse exitosos en
 *    un retry inmediato). 3 retries para el resto (errores transient).
 *  - `refetchOnWindowFocus: true` — al volver a la tab, refresca.
 *    Algunas queries especificas (leaderboard polling) lo desactivan.
 *  - `mutations.onError`: toast generico — paginas pueden override.
 */
function makeQueryClient(): QueryClient {
  const config: QueryClientConfig = {
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          const status = (error as { response?: { status?: number } })
            ?.response?.status;
          if (status === 401 || status === 404) return false;
          return failureCount < 3;
        },
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        onError: (err) => {
          const message =
            err instanceof Error
              ? err.message
              : "Algo salio mal. Intentalo de nuevo.";
          toast.error(message);
        },
      },
    },
  };
  return new QueryClient(config);
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState garantiza que el client se crea UNA vez por mount,
  // sobreviviendo a re-renders. NO crear con `new QueryClient()` en
  // top-level (eso lo compartiria entre requests en SSR).
  const [client] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>
  );
}

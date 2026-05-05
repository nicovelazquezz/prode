"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { HTTPError } from "ky";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { LeaderboardTable } from "@/components/domain/leaderboard-table";
import { PublicProfileDrawer } from "@/components/domain/public-profile-drawer";
import { queryKeys } from "@/lib/api/queryKeys";
import { getByLeague } from "@/lib/api/leaderboard";
import { getMyLeagues } from "@/lib/api/leagues";
import { useAuth } from "@/lib/hooks/use-auth";
import { cn } from "@/lib/utils/cn";

/**
 * /leaderboard/liga/[leagueId] — tabla de posiciones filtrada a
 * los miembros de una mini-liga. Polling 30s, manejo explicito de
 * 403 (no miembro) → mensaje + CTA volver.
 */
export default function LeagueLeaderboardPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  // Next.js 15+ pasa params como Promise. `use()` lo unwraps.
  const { leagueId } = use(params);
  const { user } = useAuth();
  const [page, setPage] = useState<number>(1);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  // Lookup de la liga para mostrar nombre + memberCount. Reusamos
  // `getMyLeagues` (cache) y filtramos por id; si la liga no esta
  // en /leagues/me, el user no es miembro → la query del leaderboard
  // tirara 403 igualmente.
  const myLeaguesQuery = useQuery({
    queryKey: queryKeys.leagues.me(),
    queryFn: () => getMyLeagues(),
    staleTime: 60_000,
  });
  const league = myLeaguesQuery.data?.find((l) => l.id === leagueId);

  const leaderboardQuery = useQuery({
    queryKey: queryKeys.leaderboard.league(leagueId, page),
    queryFn: () => getByLeague(leagueId, { page, pageSize: 50 }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      // No reintentamos en 401/403/404 — son terminal states.
      if (
        error instanceof HTTPError &&
        [401, 403, 404].includes(error.response.status)
      ) {
        return false;
      }
      return failureCount < 3;
    },
  });

  const isForbidden =
    leaderboardQuery.isError &&
    leaderboardQuery.error instanceof HTTPError &&
    leaderboardQuery.error.response.status === 403;

  const isNotFound =
    leaderboardQuery.isError &&
    leaderboardQuery.error instanceof HTTPError &&
    leaderboardQuery.error.response.status === 404;

  if (isForbidden || isNotFound) {
    return (
      <section className="mx-auto max-w-2xl px-4 py-12 md:px-8 text-center">
        <p className="font-display text-3xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          {isNotFound ? "Liga inexistente" : "Sin acceso"}
        </p>
        <p className="mt-3 font-sans text-sm text-[var(--color-prode-text-secondary)]">
          {isForbidden
            ? "No sos miembro de esta mini-liga."
            : "La liga que buscas no existe."}
        </p>
        <Link
          href="/leaderboard"
          className={cn(
            "mt-6 inline-flex items-center gap-2 rounded-md bg-[var(--color-prode-near-black)] px-6 py-3",
            "font-sans text-sm font-bold uppercase tracking-wider text-white",
            "transition-opacity duration-200 hover:opacity-90",
          )}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver
        </Link>
      </section>
    );
  }

  return (
    <>
      <section className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <Link
          href="/leaderboard"
          className="inline-flex items-center gap-2 mb-3 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)]"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Volver al leaderboard
        </Link>

        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide leading-none text-[var(--color-prode-near-black)] truncate">
              {league?.name ?? "Liga"}
            </h1>
            {league ? (
              <p className="mt-1 font-sans text-sm text-[var(--color-prode-text-secondary)]">
                {league.memberCount ?? 0} miembros
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => leaderboardQuery.refetch()}
            aria-label="Refrescar tabla"
            className={cn(
              "shrink-0 inline-flex items-center gap-2 rounded-md border border-[var(--color-prode-border)] bg-white px-3 py-2",
              "font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-near-black)]",
              "transition-colors duration-200 hover:bg-[var(--color-prode-surface)]",
            )}
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                leaderboardQuery.isFetching && "animate-spin",
              )}
              aria-hidden
            />
            Refrescar
          </button>
        </div>

        <LeaderboardTable
          entries={leaderboardQuery.data?.entries ?? []}
          currentUserId={user?.id ?? null}
          loading={leaderboardQuery.isLoading}
          onRowClick={setProfileUserId}
          emptyMessage="Esta liga no tiene posiciones aun."
        />

        {leaderboardQuery.data &&
        leaderboardQuery.data.total > leaderboardQuery.data.pageSize ? (
          <Pagination
            page={page}
            pageSize={leaderboardQuery.data.pageSize}
            total={leaderboardQuery.data.total}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      <PublicProfileDrawer
        userId={profileUserId}
        onOpenChange={(open) => !open && setProfileUserId(null)}
      />
    </>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={cn(
          "rounded-md border border-[var(--color-prode-border)] bg-white px-4 py-2",
          "font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-near-black)]",
          "disabled:opacity-50 disabled:pointer-events-none",
          "transition-colors duration-200 hover:bg-[var(--color-prode-surface)]",
        )}
      >
        Anterior
      </button>
      <span className="font-sans text-xs uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
        Pagina {page} de {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={cn(
          "rounded-md border border-[var(--color-prode-border)] bg-white px-4 py-2",
          "font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-near-black)]",
          "disabled:opacity-50 disabled:pointer-events-none",
          "transition-colors duration-200 hover:bg-[var(--color-prode-surface)]",
        )}
      >
        Siguiente
      </button>
    </div>
  );
}

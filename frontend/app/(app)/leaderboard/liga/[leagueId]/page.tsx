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
import { useActiveEntry } from "@/lib/hooks/use-active-entry";
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
  const { activeEntry } = useActiveEntry();
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
      <section className="mx-auto max-w-2xl px-4 py-16 md:px-8 text-center">
        <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          {isNotFound ? "404" : "403"}
        </div>
        <p className="mt-3 font-[family-name:var(--font-landing-display)] text-4xl uppercase tracking-tight leading-[0.9] text-[var(--color-landing-text)]">
          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
            {isNotFound ? "Liga inexistente" : "Sin acceso"}
          </span>
        </p>
        <p className="mt-5 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
          {isForbidden
            ? "No sos miembro de esta mini-liga."
            : "La liga que buscas no existe."}
        </p>
        <Link
          href="/leaderboard"
          className="mt-8 inline-flex items-center gap-2 rounded-sm bg-[var(--color-landing-red)] px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver
        </Link>
      </section>
    );
  }

  return (
    <>
      <section className="mx-auto max-w-3xl px-4 pb-20 pt-10 md:px-8 md:pb-24 md:pt-14">
        <Link
          href="/leaderboard"
          className="inline-flex items-center gap-2 mb-4 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)]"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Volver al leaderboard
        </Link>

        <div className="flex items-start justify-between gap-3 mb-6">
          <div className="min-w-0">
            <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
              Mini-liga
            </div>
            <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)] truncate">
              <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
                {league?.name ?? "Liga"}
              </span>
            </h1>
            {league ? (
              <p className="mt-3 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
                {league.memberCount ?? 0} miembros
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => leaderboardQuery.refetch()}
            aria-label="Refrescar tabla"
            className="shrink-0 inline-flex items-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-3 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
          >
            <span
              role="status"
              aria-label={leaderboardQuery.isFetching ? "Refrescando" : "Actualizado"}
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                leaderboardQuery.isFetching
                  ? "bg-[var(--color-landing-red)] landing-pulse"
                  : "bg-[var(--color-landing-text-muted)]",
              )}
            />
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                leaderboardQuery.isFetching && "animate-spin",
              )}
              aria-hidden
            />
            Refrescar
          </button>
        </div>

        <LeaderboardTable
          entries={leaderboardQuery.data?.entries ?? []}
          currentEntryId={activeEntry?.id ?? null}
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
  const navBtn =
    "rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={navBtn}
      >
        ← Anterior
      </button>
      <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
        Página {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={navBtn}
      >
        Siguiente →
      </button>
    </div>
  );
}

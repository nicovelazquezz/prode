"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LeaderboardTable } from "@/components/domain/leaderboard-table";
import { PublicProfileDrawer } from "@/components/domain/public-profile-drawer";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  getGlobal,
  getByPhase,
  getMyAround,
} from "@/lib/api/leaderboard";
import { getMyLeagues } from "@/lib/api/leagues";
import type { Phase } from "@/lib/api/types";
import { useAuth } from "@/lib/hooks/use-auth";
import { cn } from "@/lib/utils/cn";

type TabValue = "global" | "phase" | "leagues";

const PHASE_OPTIONS: Array<{ value: Phase; label: string }> = [
  { value: "GROUPS", label: "Fase de grupos" },
  { value: "ROUND_32", label: "16avos" },
  { value: "ROUND_16", label: "Octavos" },
  { value: "QUARTERS", label: "Cuartos" },
  { value: "SEMIS", label: "Semifinales" },
  { value: "THIRD_PLACE", label: "Tercer puesto" },
  { value: "FINAL", label: "Final" },
];

/**
 * /leaderboard — tabla de posiciones con 3 tabs (Global, Por fase,
 * Mis ligas). Hero arriba con la posicion del current user.
 *
 * Polling: 30s, pausado en background, sin refetch on focus
 * (spec §6.8). Boton manual "Refrescar" en header. Pulse dot
 * indicator cuando esta refrescando.
 */
export default function LeaderboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabValue>("global");
  const [phase, setPhase] = useState<Phase>("GROUPS");
  const [page, setPage] = useState<number>(1);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  // Hero data: my position globally.
  const meAroundQuery = useQuery({
    queryKey: queryKeys.leaderboard.around(),
    queryFn: () => getMyAround(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  // Tab GLOBAL.
  const globalQuery = useQuery({
    queryKey: queryKeys.leaderboard.global(page),
    queryFn: () => getGlobal({ page, pageSize: 50 }),
    enabled: tab === "global",
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  // Tab PHASE.
  const phaseQuery = useQuery({
    queryKey: queryKeys.leaderboard.phase(phase, page),
    queryFn: () => getByPhase(phase, { page, pageSize: 50 }),
    enabled: tab === "phase",
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  // Tab LEAGUES.
  const leaguesQuery = useQuery({
    queryKey: queryKeys.leagues.me(),
    queryFn: () => getMyLeagues(),
    enabled: tab === "leagues",
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const activeQuery =
    tab === "global"
      ? globalQuery
      : tab === "phase"
        ? phaseQuery
        : leaguesQuery;

  const isFetching = activeQuery.isFetching || meAroundQuery.isFetching;

  const refresh = () => {
    void meAroundQuery.refetch();
    if (tab === "global") void globalQuery.refetch();
    else if (tab === "phase") void phaseQuery.refetch();
    else void leaguesQuery.refetch();
  };

  return (
    <>
      <section className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide leading-none text-[var(--color-prode-near-black)]">
            Tabla
          </h1>
          <div className="flex items-center gap-2">
            <span
              role="status"
              aria-label={isFetching ? "Refrescando" : "Actualizado"}
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                isFetching
                  ? "bg-[var(--color-prode-accent)] animate-pulse"
                  : "bg-[var(--color-prode-border)]",
              )}
            />
            <button
              type="button"
              onClick={refresh}
              aria-label="Refrescar tabla"
              className={cn(
                "inline-flex items-center gap-2 rounded-md border border-[var(--color-prode-border)] bg-white px-3 py-2",
                "font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-near-black)]",
                "transition-colors duration-200 hover:bg-[var(--color-prode-surface)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-offset-2",
              )}
            >
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} aria-hidden />
              Refrescar
            </button>
          </div>
        </div>

        <Hero
          loading={meAroundQuery.isLoading}
          position={meAroundQuery.data?.position}
          totalUsers={meAroundQuery.data?.totalUsers}
          totalPoints={meAroundQuery.data?.totalPoints}
        />

        <div className="mt-6">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as TabValue);
              setPage(1);
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="global" className="flex-1">GLOBAL</TabsTrigger>
              <TabsTrigger value="phase" className="flex-1">POR FASE</TabsTrigger>
              <TabsTrigger value="leagues" className="flex-1">MIS LIGAS</TabsTrigger>
            </TabsList>

            <TabsContent value="global">
              <LeaderboardTable
                entries={globalQuery.data?.entries ?? []}
                currentUserId={user?.id ?? null}
                loading={globalQuery.isLoading}
                onRowClick={setProfileUserId}
                emptyMessage="Aun no hay posiciones cargadas."
              />
              <Pagination
                page={page}
                pageSize={globalQuery.data?.pageSize ?? 50}
                total={globalQuery.data?.total ?? 0}
                onPageChange={setPage}
              />
            </TabsContent>

            <TabsContent value="phase">
              <div className="mb-4">
                <label
                  htmlFor="phase-select"
                  className="block font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)] mb-1"
                >
                  Elegi una fase
                </label>
                <select
                  id="phase-select"
                  value={phase}
                  onChange={(e) => {
                    setPhase(e.target.value as Phase);
                    setPage(1);
                  }}
                  className={cn(
                    "h-12 w-full rounded-md border border-[var(--color-prode-border)] bg-white px-3",
                    "font-sans text-sm text-[var(--color-prode-near-black)]",
                    "focus:outline-none focus:ring-2 focus:ring-[var(--color-prode-near-black)] focus:ring-offset-2",
                  )}
                >
                  {PHASE_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <LeaderboardTable
                entries={phaseQuery.data?.entries ?? []}
                currentUserId={user?.id ?? null}
                loading={phaseQuery.isLoading}
                onRowClick={setProfileUserId}
                emptyMessage="Sin puntos en esta fase aun."
              />
              <Pagination
                page={page}
                pageSize={phaseQuery.data?.pageSize ?? 50}
                total={phaseQuery.data?.total ?? 0}
                onPageChange={setPage}
              />
            </TabsContent>

            <TabsContent value="leagues">
              <LeaguesList
                loading={leaguesQuery.isLoading}
                leagues={leaguesQuery.data ?? []}
              />
            </TabsContent>
          </Tabs>
        </div>
      </section>

      <PublicProfileDrawer
        userId={profileUserId}
        onOpenChange={(open) => !open && setProfileUserId(null)}
      />
    </>
  );
}

function Hero({
  loading,
  position,
  totalUsers,
  totalPoints,
}: {
  loading: boolean;
  position?: number;
  totalUsers?: number;
  totalPoints?: number;
}) {
  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        className="rounded-md border border-[var(--color-prode-border)] bg-white p-6"
      >
        <div className="h-20 w-2/3 bg-[var(--color-prode-surface)] rounded animate-pulse" />
        <div className="mt-3 h-8 w-1/3 bg-[var(--color-prode-surface)] rounded animate-pulse" />
      </div>
    );
  }
  if (position === undefined || totalUsers === undefined) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-prode-border)] bg-white p-6 text-center">
        <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
          Cargas mas predicciones para entrar al ranking.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-[var(--color-prode-border)] bg-white p-6">
      <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
        Tu posicion
      </p>
      <p
        className="mt-1 font-display font-black uppercase tracking-tight leading-none text-[var(--color-prode-near-black)]"
        style={{ fontSize: "clamp(48px, 12vw, 80px)" }}
      >
        #<span className="text-[var(--color-prode-accent)]">{position}</span>
        <span className="font-sans text-base font-bold ml-3 align-middle text-[var(--color-prode-text-secondary)]">
          de {totalUsers}
        </span>
      </p>
      <p
        className="mt-2 font-display font-black tracking-tight text-[var(--color-prode-near-black)]"
        style={{ fontSize: "32px" }}
      >
        {totalPoints ?? 0}{" "}
        <span className="font-sans text-base font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
          PTS
        </span>
      </p>
    </div>
  );
}

function LeaguesList({
  loading,
  leagues,
}: {
  loading: boolean;
  leagues: Array<{
    id: string;
    name: string;
    memberCount?: number;
  }>;
}) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-md bg-[var(--color-prode-surface)] animate-pulse"
          />
        ))}
      </div>
    );
  }
  if (!leagues.length) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-prode-border)] bg-white p-8 text-center">
        <p className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          Sin ligas
        </p>
        <p className="mt-2 font-sans text-sm text-[var(--color-prode-text-secondary)]">
          Todavia no perteneces a ninguna mini-liga.
        </p>
        <Link
          href="/ligas"
          className="mt-4 inline-flex items-center justify-center font-sans text-sm font-bold uppercase tracking-wider text-[var(--color-prode-near-black)] underline underline-offset-4"
        >
          Ir a Ligas
        </Link>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Mis ligas">
      {leagues.map((l) => (
        <li
          key={l.id}
          className="rounded-md border border-[var(--color-prode-border)] bg-white p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-xl font-black uppercase tracking-wide truncate text-[var(--color-prode-near-black)]">
                {l.name}
              </p>
              <p className="font-sans text-xs uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
                {l.memberCount ?? 0} miembros
              </p>
            </div>
            <Link
              href={`/leaderboard/liga/${l.id}`}
              className={cn(
                "inline-flex items-center justify-center rounded-md bg-[var(--color-prode-near-black)] px-4 py-2",
                "font-sans text-xs font-bold uppercase tracking-wider text-white",
                "transition-opacity duration-200 hover:opacity-90",
              )}
            >
              Ver tabla
            </Link>
          </div>
        </li>
      ))}
    </ul>
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
  if (totalPages <= 1) return null;
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

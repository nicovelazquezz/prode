"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LeaderboardTable } from "@/components/domain/leaderboard-table";
import { Pagination } from "@/components/domain/pagination";
import { PublicProfileDrawer } from "@/components/domain/public-profile-drawer";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  getGlobal,
  getByPhase,
  getAroundEntry,
} from "@/lib/api/leaderboard";
import { getMyLeagues } from "@/lib/api/leagues";
import { getMatches } from "@/lib/api/matches";
import type { Phase } from "@/lib/api/types";
import { useActiveEntry } from "@/lib/hooks/use-active-entry";
import {
  PHASE_LABEL,
  deriveAvailablePhases,
} from "@/lib/landing/available-phases";
import { cn } from "@/lib/utils/cn";

type TabValue = "global" | "phase" | "leagues";

/**
 * /leaderboard — tabla de posiciones, estética stadium (landing
 * mantra). Hero con eyebrow + Anton number gigante, 3 tabs (Global,
 * Por fase, Mis ligas). Polling 30s, sin refetch on focus, botón
 * manual "Refrescar" + dot pulse cuando está fetcheando.
 *
 * Phase select solo muestra las fases que ya tienen matches cargados.
 */
export default function LeaderboardPage() {
  const { activeEntry } = useActiveEntry();
  const entryId = activeEntry?.id ?? "";
  const [tab, setTab] = useState<TabValue>("global");
  const [phase, setPhase] = useState<Phase>("GROUPS");
  const [page, setPage] = useState<number>(1);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  // Hero data: ranking del entry activo del user.
  const meAroundQuery = useQuery({
    queryKey: queryKeys.leaderboard.aroundEntry(entryId),
    queryFn: () => getAroundEntry(entryId),
    enabled: !!entryId,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  // All matches → derive available phases.
  const matchesQuery = useQuery({
    queryKey: queryKeys.matches.list(),
    queryFn: () => getMatches({ pageSize: 200 }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const availablePhases = deriveAvailablePhases(matchesQuery.data);

  const globalQuery = useQuery({
    queryKey: queryKeys.leaderboard.global(page),
    queryFn: () => getGlobal({ page, pageSize: 50 }),
    enabled: tab === "global",
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const phaseQuery = useQuery({
    queryKey: queryKeys.leaderboard.phase(phase, page),
    queryFn: () => getByPhase(phase, { page, pageSize: 50 }),
    enabled: tab === "phase" && availablePhases.includes(phase),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const leaguesQuery = useQuery({
    queryKey: queryKeys.leagues.me(),
    queryFn: () => getMyLeagues(),
    enabled: tab === "leagues",
    staleTime: 60_000,
    refetchInterval: 60_000,
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

  // Asegurar que el phase seleccionado esté disponible. Si la fase actual
  // ya no está habilitada, fallback a la primera disponible.
  const effectivePhase = availablePhases.includes(phase)
    ? phase
    : (availablePhases[0] ?? "GROUPS");

  return (
    <>
      <section className="mx-auto max-w-3xl px-4 pb-20 pt-10 md:px-8 md:pb-24 md:pt-14">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
              Tu ranking
            </div>
            <h1 className="font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-[0.85] tracking-tight md:text-6xl">
              <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
                Tabla.
              </span>
            </h1>
          </div>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refrescar tabla"
            className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-3 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors duration-200 hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
          >
            <span
              role="status"
              aria-label={isFetching ? "Refrescando" : "Actualizado"}
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                isFetching
                  ? "bg-[var(--color-landing-red)] landing-pulse"
                  : "bg-[var(--color-landing-text-muted)]",
              )}
            />
            <RefreshCw
              className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
              aria-hidden
            />
            Refrescar
          </button>
        </div>

        <Hero
          loading={meAroundQuery.isLoading}
          position={meAroundQuery.data?.position}
          totalUsers={meAroundQuery.data?.totalUsers}
          totalPoints={meAroundQuery.data?.totalPoints}
        />

        <div className="mt-10">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as TabValue);
              setPage(1);
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="global" className="flex-1">Global</TabsTrigger>
              <TabsTrigger value="phase" className="flex-1">Por fase</TabsTrigger>
              <TabsTrigger value="leagues" className="flex-1">Mis ligas</TabsTrigger>
            </TabsList>

            <TabsContent value="global">
              <LeaderboardTable
                entries={globalQuery.data?.entries ?? []}
                currentEntryId={entryId || null}
                loading={globalQuery.isLoading}
                onRowClick={setProfileUserId}
                emptyMessage="Aún no hay posiciones cargadas"
              />
              <Pagination
                page={page}
                pageSize={globalQuery.data?.pageSize ?? 50}
                total={globalQuery.data?.total ?? 0}
                onPageChange={setPage}
              />
            </TabsContent>

            <TabsContent value="phase">
              <PhaseSelect
                value={effectivePhase}
                phases={availablePhases}
                onChange={(p) => {
                  setPhase(p);
                  setPage(1);
                }}
              />
              <LeaderboardTable
                entries={phaseQuery.data?.entries ?? []}
                currentEntryId={entryId || null}
                loading={phaseQuery.isLoading}
                onRowClick={setProfileUserId}
                emptyMessage="Sin puntos en esta fase aún"
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
        className="mt-8 border-y border-[var(--color-landing-line-strong)] py-10"
      >
        <div className="h-4 w-24 bg-[var(--color-landing-surface)] rounded-sm animate-pulse" />
        <div className="mt-4 h-16 w-48 bg-[var(--color-landing-surface)] rounded-sm animate-pulse" />
        <div className="mt-3 h-8 w-32 bg-[var(--color-landing-surface)] rounded-sm animate-pulse" />
      </div>
    );
  }
  if (position === undefined || totalUsers === undefined) {
    return (
      <div className="mt-8 border-y border-dashed border-[var(--color-landing-line-strong)] py-10 text-center">
        <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Sin ranking aún
        </p>
        <p className="mt-3 font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Cargá más predicciones para entrar.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-8 border-y border-[var(--color-landing-line-strong)] py-10">
      <div className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        Tu posición
      </div>
      <p
        className="mt-3 font-[family-name:var(--font-landing-display)] uppercase leading-[0.85] tracking-tight"
        style={{ fontSize: "clamp(64px, 14vw, 112px)" }}
      >
        <span className="text-[var(--color-landing-text-muted)]">#</span>
        <span className="text-[var(--color-landing-red)]">{position}</span>
        <span className="ml-3 align-middle font-[family-name:var(--font-landing-mono)] text-sm uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
          de {totalUsers}
        </span>
      </p>
      <p className="mt-2 font-[family-name:var(--font-landing-display)] text-4xl tabular-nums leading-none text-[var(--color-landing-text)]">
        {totalPoints ?? 0}{" "}
        <span className="ml-1 font-[family-name:var(--font-landing-mono)] text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
          PTS
        </span>
      </p>
    </div>
  );
}

function PhaseSelect({
  value,
  phases,
  onChange,
}: {
  value: Phase;
  phases: Phase[];
  onChange: (next: Phase) => void;
}) {
  return (
    <div className="mb-6">
      <label
        htmlFor="phase-select"
        className="mb-2 block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]"
      >
        Elegí una fase
      </label>
      <select
        id="phase-select"
        value={value}
        onChange={(e) => onChange(e.target.value as Phase)}
        className="h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-3 text-base text-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
      >
        {phases.map((p) => (
          <option
            key={p}
            value={p}
            className="bg-[var(--color-landing-surface)] text-[var(--color-landing-text)]"
          >
            {PHASE_LABEL[p]}
          </option>
        ))}
      </select>
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
            className="h-20 rounded-sm bg-[var(--color-landing-surface)] animate-pulse"
          />
        ))}
      </div>
    );
  }
  if (!leagues.length) {
    return (
      <div className="border border-dashed border-[var(--color-landing-line-strong)] rounded-sm p-10 text-center">
        <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Sin ligas
        </p>
        <p className="mt-3 font-[family-name:var(--font-landing-display)] text-3xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Todavía no estás en una mini-liga.
        </p>
        <Link
          href="/ligas"
          className="mt-5 inline-block rounded-sm bg-[var(--color-landing-red)] px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
        >
          Ir a Ligas →
        </Link>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Mis ligas">
      {leagues.map((l) => (
        <li
          key={l.id}
          className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight truncate text-[var(--color-landing-text)]">
                {l.name}
              </p>
              <p className="mt-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
                {l.memberCount ?? 0} miembros
              </p>
            </div>
            <Link
              href={`/leaderboard/liga/${l.id}`}
              className="shrink-0 rounded-sm bg-[var(--color-landing-red)] px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
            >
              Ver tabla
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}


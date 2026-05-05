"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Users, Crown, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/api/queryKeys";
import { getMyLeagues } from "@/lib/api/leagues";
import { useAuth } from "@/lib/hooks/use-auth";
import { cn } from "@/lib/utils/cn";

/**
 * /ligas — lista de mini-ligas del user. Cada card con name,
 * memberCount, badge "Owner" si aplica, y CTA "Ver tabla" → la
 * pagina /leaderboard/liga/[id].
 *
 * 2 CTAs prominentes arriba: "Crear nueva" + "Unirme con codigo".
 */
export default function LigasPage() {
  const { user } = useAuth();
  const leaguesQuery = useQuery({
    queryKey: queryKeys.leagues.me(),
    queryFn: () => getMyLeagues(),
    staleTime: 60_000,
  });

  return (
    <section className="mx-auto max-w-2xl px-4 py-6 md:px-8">
      <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide leading-none text-[var(--color-prode-near-black)]">
        Mis ligas
      </h1>
      <p className="mt-2 font-sans text-sm text-[var(--color-prode-text-secondary)]">
        Compite con tus amigos en una mini-tabla privada.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/ligas/crear" className="block">
          <Button
            variant="primary"
            className="w-full justify-center gap-2"
            size="lg"
          >
            <Plus className="h-5 w-5" aria-hidden />
            Crear nueva
          </Button>
        </Link>
        <Link href="/ligas/unirme" className="block">
          <Button
            variant="outlined"
            className="w-full justify-center gap-2"
            size="lg"
          >
            <KeyRound className="h-5 w-5" aria-hidden />
            Unirme con codigo
          </Button>
        </Link>
      </div>

      <div className="mt-8">
        {leaguesQuery.isLoading ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-md bg-[var(--color-prode-surface)] animate-pulse"
              />
            ))}
          </div>
        ) : !leaguesQuery.data || leaguesQuery.data.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--color-prode-border)] bg-white p-8 text-center">
            <p className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
              Sin ligas
            </p>
            <p className="mt-2 font-sans text-sm text-[var(--color-prode-text-secondary)]">
              Crea una nueva o unite con un codigo.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Mis ligas">
            {leaguesQuery.data.map((l) => (
              <li
                key={l.id}
                className="rounded-md border border-[var(--color-prode-border)] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-display text-xl font-black uppercase tracking-wide truncate text-[var(--color-prode-near-black)]">
                        {l.name}
                      </p>
                      {user && l.ownerId === user.id ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-pill bg-[var(--color-prode-near-black)] px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wider text-white"
                          aria-label="Sos el propietario de esta liga"
                        >
                          <Crown className="h-3 w-3" aria-hidden />
                          Owner
                        </span>
                      ) : null}
                    </div>
                    {l.description ? (
                      <p className="mt-1 font-sans text-xs text-[var(--color-prode-text-secondary)] line-clamp-2">
                        {l.description}
                      </p>
                    ) : null}
                    <div className="mt-2 flex items-center gap-3 font-sans text-xs uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" aria-hidden />
                        {l.memberCount ?? 0} miembros
                      </span>
                      <span className="font-mono text-[var(--color-prode-text-muted)]">
                        {l.inviteCode}
                      </span>
                    </div>
                  </div>
                  <Link
                    href={`/leaderboard/liga/${l.id}`}
                    className={cn(
                      "shrink-0 inline-flex items-center justify-center rounded-md bg-[var(--color-prode-near-black)] px-4 py-2",
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
        )}
      </div>
    </section>
  );
}

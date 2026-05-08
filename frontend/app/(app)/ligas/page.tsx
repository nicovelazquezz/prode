"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Users, Crown, KeyRound, Share2 } from "lucide-react";
import { queryKeys } from "@/lib/api/queryKeys";
import { getMyLeagues } from "@/lib/api/leagues";
import { useAuth } from "@/lib/hooks/use-auth";

/**
 * Arma el deep link `wa.me/?text=...` para invitar a una mini-liga.
 * NO depende del backend de WhatsApp — es solo un link que abre
 * WhatsApp en el celular del que clickea con el mensaje pre-armado.
 *
 * El user del enlace todavía tiene que (a) elegir un contacto al que
 * mandárselo, (b) tocar enviar. wa.me funciona en mobile (app nativa)
 * y desktop (WhatsApp Web). Si no tiene WhatsApp instalado, abre el
 * landing de WhatsApp.
 */
function buildShareUrl(opts: {
  leagueName: string;
  inviteCode: string;
  joinUrl: string;
}): string {
  const message = `🏆 Te invito a mi prode "${opts.leagueName}" del Mundial 2026!\n\nCódigo: ${opts.inviteCode}\n\nEntrá acá → ${opts.joinUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

const ctaPrimary =
  "inline-flex items-center justify-center gap-2 rounded-sm bg-[var(--color-landing-red)] px-6 py-4 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

const ctaGhost =
  "inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 py-4 font-[family-name:var(--font-landing-mono)] text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

/**
 * /ligas — lista de mini-ligas del user, estética stadium (landing
 * mantra). 2 CTAs prominentes (Crear / Unirme), seguidos por la lista
 * de ligas con owner badge cuando aplica.
 */
export default function LigasPage() {
  const { user } = useAuth();
  const leaguesQuery = useQuery({
    queryKey: queryKeys.leagues.me(),
    queryFn: () => getMyLeagues(),
    staleTime: 60_000,
  });

  return (
    <section className="mx-auto max-w-2xl px-4 pb-20 pt-10 md:px-8 md:pb-24 md:pt-14">
      <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        Mini-ligas
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-[0.85] tracking-tight md:text-6xl">
        <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
          Tus ligas.
        </span>
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--color-landing-text-muted)] md:text-base">
        Competí con tus amigos en una mini-tabla privada.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link href="/ligas/crear" className={ctaPrimary}>
          <Plus className="h-4 w-4" aria-hidden />
          Crear nueva
        </Link>
        <Link href="/ligas/unirme" className={ctaGhost}>
          <KeyRound className="h-4 w-4" aria-hidden />
          Unirme con código
        </Link>
      </div>

      <div className="mt-10">
        {leaguesQuery.isLoading ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-sm bg-[var(--color-landing-surface)] animate-pulse"
              />
            ))}
          </div>
        ) : !leaguesQuery.data || leaguesQuery.data.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[var(--color-landing-line-strong)] p-10 text-center">
            <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
              Sin ligas
            </p>
            <p className="mt-3 font-[family-name:var(--font-landing-display)] text-3xl uppercase tracking-tight text-[var(--color-landing-text)]">
              Creá una nueva o unite con un código.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Mis ligas">
            {leaguesQuery.data.map((l) => {
              const isOwner = user && l.ownerId === user.id;
              return (
                <li
                  key={l.id}
                  className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight truncate text-[var(--color-landing-text)]">
                          {l.name}
                        </p>
                        {isOwner ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-landing-green)] px-2 py-0.5 font-[family-name:var(--font-landing-mono)] text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--color-landing-text)]"
                            aria-label="Sos el propietario de esta liga"
                          >
                            <Crown className="h-3 w-3" aria-hidden />
                            Owner
                          </span>
                        ) : null}
                      </div>
                      {l.description ? (
                        <p className="mt-2 text-sm leading-relaxed text-[var(--color-landing-text-muted)] line-clamp-2">
                          {l.description}
                        </p>
                      ) : null}
                      <div className="mt-3 flex items-center gap-4 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3 w-3" aria-hidden />
                          {l.memberCount ?? 0} miembros
                        </span>
                        <span className="font-[family-name:var(--font-landing-mono)] text-[var(--color-landing-gold)]">
                          {l.inviteCode}
                        </span>
                      </div>
                      <a
                        href={buildShareUrl({
                          leagueName: l.name,
                          inviteCode: l.inviteCode,
                          joinUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/ligas/unirme?code=${l.inviteCode}`,
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-green)] underline underline-offset-4 decoration-[var(--color-landing-green)] decoration-2 hover:text-[var(--color-landing-text)] hover:decoration-[var(--color-landing-text)] transition-colors"
                        aria-label={`Compartir ${l.name} por WhatsApp`}
                      >
                        <Share2 className="h-3 w-3" aria-hidden />
                        Compartir por WhatsApp
                      </a>
                    </div>
                    <Link
                      href={`/leaderboard/liga/${l.id}`}
                      className="shrink-0 rounded-sm bg-[var(--color-landing-red)] px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
                    >
                      Ver tabla
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

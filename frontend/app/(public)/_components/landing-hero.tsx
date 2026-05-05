"use client";

import { useQuery } from "@tanstack/react-query";
import { CountdownTimer } from "@/components/domain/countdown-timer";
import { queryKeys } from "@/lib/api/queryKeys";
import { getPublicStats } from "@/lib/api/stats";
import { cn } from "@/lib/utils/cn";

const KICKOFF_ISO =
  process.env.NEXT_PUBLIC_WORLD_CUP_START ?? "2026-06-11T18:00:00-03:00";

function formatARS(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Stats bar live — `GET /stats/public` con polling 30s.
 *
 * Si la query falla (backend caido, network error), degrada a
 * "0 inscriptos / pozo $0" sin romper el render del hero.
 */
function StatsBar() {
  const { data, isError } = useQuery({
    queryKey: queryKeys.stats.public(),
    queryFn: getPublicStats,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 25_000,
  });

  const enrolled = isError ? 0 : (data?.enrolledUsers ?? 0);
  const pozo = isError ? 0 : (data?.pozoEstimate ?? 0);

  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-1",
        "rounded-pill border border-white/15 bg-white/5",
        "px-4 py-2 text-sm",
        "font-sans text-white/80",
      )}
      aria-live="polite"
    >
      <span>
        <span className="font-bold tabular-nums text-white">{enrolled}</span>{" "}
        inscriptos
      </span>
      <span aria-hidden="true" className="text-white/30">
        •
      </span>
      <span>
        Pozo{" "}
        <span className="font-bold tabular-nums text-white">
          {formatARS(pozo)}
        </span>
      </span>
    </div>
  );
}

/**
 * Hero de la landing.
 *
 * Mobile-first: stack vertical con padding generoso, titulo display
 * en 3 lineas (PRODE / MUNDIAL / 2026) sin necesidad de imagenes.
 * Desktop: titulo en una sola linea ancha. Background dark navy.
 */
export function LandingHero() {
  return (
    <section
      className="relative isolate flex min-h-[100svh] w-full flex-col overflow-hidden"
      style={{ backgroundColor: "var(--color-prode-deep-navy)" }}
    >
      {/* Subtle decorative grid lines (4% white) */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-4 py-10 md:px-8 md:py-16">
        <p className="font-sans text-[10px] md:text-xs font-bold uppercase tracking-[0.18em] text-white/60 mb-6 md:mb-8">
          Club Tiro Federal de Bahia Blanca
        </p>

        <h1
          className={cn(
            "font-display font-black uppercase tracking-tight",
            "text-white leading-[0.85]",
            "text-6xl sm:text-7xl md:text-[80px] lg:text-[96px]",
          )}
        >
          <span className="block">Prode</span>
          <span className="block">Mundial</span>
          <span className="block text-[var(--color-prode-accent)]">2026</span>
        </h1>

        <p className="mt-6 max-w-md font-sans text-base md:text-lg text-white/75">
          Pronosticos de los 104 partidos del Mundial. Inscribite, jugá
          contra tus amigos del club y ganá el pozo.
        </p>

        <div className="mt-8 md:mt-10">
          <StatsBar />
        </div>

        <div className="mt-10 md:mt-14 flex flex-col gap-3">
          <p className="font-sans text-[10px] md:text-xs font-bold uppercase tracking-[0.18em] text-white/60">
            Faltan para el kickoff
          </p>
          {/* Override de las CSS vars que CountdownTimer usa internamente
              (`--color-prode-near-black` para los numeros y
              `--color-prode-text-secondary` para los labels). De esta
              forma el countdown se adapta al hero dark sin tocar el
              componente compartido. */}
          <div
            style={
              {
                "--color-prode-near-black": "#ffffff",
                "--color-prode-text-secondary": "rgba(255,255,255,0.6)",
              } as React.CSSProperties
            }
          >
            <CountdownTimer
              targetIso={KICKOFF_ISO}
              finishedLabel="Empezo el Mundial!"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

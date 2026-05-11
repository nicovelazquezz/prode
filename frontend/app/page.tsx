import type { Metadata } from "next";
import { LandingTopbar } from "@/components/landing/landing-topbar";
import { Hero } from "@/components/landing/hero";
import { StatsBar } from "@/components/landing/stats-bar";
import { LandingCountdown } from "@/components/landing/landing-countdown";
import { HowItWorks } from "@/components/landing/how-it-works";
import { PointSystem } from "@/components/landing/point-system";
import { SpecialBets } from "@/components/landing/special-bets";
import { Prizes } from "@/components/landing/prizes";
import { SolidarityBlock } from "@/components/landing/solidarity-block";
import { FAQ } from "@/components/landing/faq";
import { FinalCTA } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/landing-footer";

export const metadata: Metadata = {
  title:
    "Prode Mundial 2026 · Bahía Blanca · Por el handball del Tiro Federal",
  description:
    "Pronosticá los partidos del Mundial 2026 fase por fase. Cada inscripción banca al equipo de handball del Tiro Federal que viaja al Nacional C en Comodoro Rivadavia. Inscripción $10.000.",
  openGraph: {
    title: "Prode Mundial 2026 · Bahía Blanca",
    description:
      "Jugá el prode, bancá el viaje. Inscripción $10.000. Cierra 11 de junio.",
    type: "website",
    locale: "es_AR",
  },
};

const KICKOFF_ISO = "2026-06-11T12:00:00-03:00";

/**
 * Días enteros entre ahora y el kickoff. Floor — si faltan 36h, dice 1.
 * El countdown completo (días/horas/min/seg) vive en el componente
 * `LandingCountdown` que tickea cada segundo en el cliente.
 */
function daysUntilKickoff(): number {
  const now = Date.now();
  const target = new Date(KICKOFF_ISO).getTime();
  const diff = target - now;
  return Math.max(0, Math.floor(diff / 86_400_000));
}

/**
 * Re-render hourly so the days counter in the strip top + hero eyebrow
 * stays fresh without making the page fully dynamic on every request.
 */
export const revalidate = 3600;

export default function LandingPage() {
  const daysToKickoff = daysUntilKickoff();
  return (
    <main className="landing-root min-h-screen bg-[var(--color-landing-bg)] text-[var(--color-landing-text)]">
      <LandingTopbar />
      <Hero daysToKickoff={daysToKickoff} />
      <StatsBar />
      <LandingCountdown />
      <HowItWorks />
      <PointSystem />
      <SpecialBets />
      <Prizes />
      <SolidarityBlock />
      <FAQ />
      <FinalCTA />
      <LandingFooter />
    </main>
  );
}

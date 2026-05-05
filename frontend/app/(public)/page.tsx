import { LandingHero } from "./_components/landing-hero";
import { LandingCta } from "./_components/landing-cta";
import { HowItWorks } from "@/components/domain/how-it-works";
import { LandingPrizes } from "./_components/landing-prizes";

/**
 * Landing publica del Prode (`/`). Mobile-first.
 *
 * Estructura (spec §6.1):
 *   1. Hero dark con titulo display + countdown live + stats live
 *   2. CTA section blanca con precio + CTAs Pagar / WhatsApp
 *   3. "Como funciona" — 3 cards con scroll snap mobile / grid desktop
 *   4. Premios — tabla simple
 *
 * El header y el footer estan en el layout (public).
 *
 * Renderizada como Server Component (RSC). Los widgets interactivos
 * (countdown, stats live, CTAs con mutation) son client components
 * importados como children.
 */
export default function HomePage() {
  return (
    <>
      <LandingHero />
      <LandingCta />
      <HowItWorks />
      <LandingPrizes />
    </>
  );
}

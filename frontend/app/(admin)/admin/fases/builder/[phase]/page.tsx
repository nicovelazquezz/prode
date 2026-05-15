import { notFound, redirect } from "next/navigation";
import type { BuilderPhase } from "@/lib/api/admin";
import { BuilderClient } from "./builder-client";

/**
 * `/admin/fases/builder/[phase]` — bracket builder universal para las 6
 * fases eliminatorias (Task 12 del plan bracket-builder).
 *
 * Server component delgado: sólo valida el segmento dinámico y delega
 * al cliente. THIRD_PLACE se redirige a FINAL porque los dos partidos
 * (#103 y #104) viven dentro del builder de la final — los distinguimos
 * por `matchPhase` dentro de `BuilderState.matches`.
 *
 * En esta versión de Next el `params` viene como Promise (ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`),
 * por eso hay `await` antes de leer `phase`.
 */
const VALID_PHASES: readonly BuilderPhase[] = [
  "ROUND_32",
  "ROUND_16",
  "QUARTERS",
  "SEMIS",
  "FINAL",
] as const;

interface PageProps {
  params: Promise<{ phase: string }>;
}

export default async function BuilderPage({ params }: PageProps) {
  const { phase } = await params;

  if (phase === "THIRD_PLACE") {
    redirect("/admin/fases/builder/FINAL");
  }

  if (!VALID_PHASES.includes(phase as BuilderPhase)) {
    notFound();
  }

  return <BuilderClient phase={phase as BuilderPhase} />;
}

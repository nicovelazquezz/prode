"use client";

import dynamic from "next/dynamic";
import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  AlertTriangle,
  Calculator,
  ChevronDown,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TeamFlag } from "@/components/domain/team-flag";
import { PredictionInput } from "@/components/domain/prediction-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  cancelMatch,
  finishMatch,
  getAdminMatch,
  postponeMatch,
  recalculateMatch,
  updateMatch,
} from "@/lib/api/admin";
import { getMatchesByPhase } from "@/lib/api/matches";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { Match, Team } from "@/lib/api/types";

// Lazy-load del TeamSelectModal — pesa porque incluye 48 flags. Solo
// se monta cuando el admin abre el picker.
const TeamSelectModal = dynamic(
  () =>
    import("@/components/domain/team-select-modal").then(
      (m) => m.TeamSelectModal,
    ),
);

interface PageProps {
  params: Promise<{ id: string }>;
}

const editSchema = z.object({
  homeTeamId: z.string().optional().or(z.literal("")),
  awayTeamId: z.string().optional().or(z.literal("")),
  kickoffAt: z.string().min(1, "Requerido"),
  venue: z.string().max(100).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  country: z.string().max(100).optional().or(z.literal("")),
});
type EditFormValues = z.infer<typeof editSchema>;

export default function AdminPartidoDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [recalcModalOpen, setRecalcModalOpen] = useState(false);
  // Slot del team picker abierto: "home" | "away" | null. Reemplaza los
  // inputs de texto crudos (que pedían cuids) por un picker visual con
  // flag + nombre de los 48 teams del torneo.
  const [pickerSlot, setPickerSlot] = useState<"home" | "away" | null>(null);

  const matchQuery = useQuery<Match>({
    queryKey: queryKeys.admin.matches.detail(id),
    queryFn: () => getAdminMatch(id),
    staleTime: 30_000,
  });

  const match = matchQuery.data;

  // Lista de los 48 teams del torneo, derivada de los matches de fase
  // de grupos (cada team aparece al menos una vez como home o away).
  // Cache largo (5min) — los teams no cambian durante el torneo.
  const teamsQuery = useQuery({
    queryKey: queryKeys.matches.byPhase("GROUPS"),
    queryFn: () => getMatchesByPhase("GROUPS"),
    staleTime: 5 * 60_000,
  });
  const teams = useMemo<Team[]>(() => {
    const map = new Map<string, Team>();
    for (const m of teamsQuery.data ?? []) {
      if (m.homeTeam) map.set(m.homeTeam.id, m.homeTeam);
      if (m.awayTeam) map.set(m.awayTeam.id, m.awayTeam);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [teamsQuery.data]);
  const teamById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  );

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    values: match
      ? {
          homeTeamId: match.homeTeam?.id ?? "",
          awayTeamId: match.awayTeam?.id ?? "",
          kickoffAt: toLocalDatetime(match.kickoffAt),
          venue: match.venue ?? "",
          city: "",
          country: "",
        }
      : undefined,
  });

  const updateMutation = useMutation({
    mutationFn: (vars: Parameters<typeof updateMatch>[1]) =>
      updateMatch(id, vars),
    onSuccess: () => {
      toast.success("Partido actualizado");
      qc.invalidateQueries({ queryKey: queryKeys.admin.matches.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.matches.all() });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos actualizar el partido.");
    },
  });

  const postponeMutation = useMutation({
    mutationFn: (newKickoffAt: string) =>
      postponeMatch(id, { newKickoffAt }),
    onSuccess: () => {
      toast.success("Partido pospuesto");
      qc.invalidateQueries({ queryKey: queryKeys.admin.matches.detail(id) });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos posponer el partido.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelMatch(id),
    onSuccess: () => {
      toast.success("Partido cancelado");
      qc.invalidateQueries({ queryKey: queryKeys.admin.matches.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.matches.all() });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos cancelar el partido.");
    },
  });

  if (matchQuery.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-busy="true">
        <div className="h-12 w-1/3 animate-pulse rounded bg-[var(--color-landing-surface)]" />
        <div className="h-64 animate-pulse rounded bg-[var(--color-landing-surface)]" />
      </div>
    );
  }
  if (!match) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-8 text-center">
        <p className="font-sans text-sm text-[var(--color-landing-text-muted)]">
          No encontramos el partido.
        </p>
        <Link
          href="/admin/partidos"
          className="mt-4 inline-flex items-center gap-2 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-landing-text)] underline"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Volver
        </Link>
      </div>
    );
  }

  const onSubmit = (values: EditFormValues) => {
    updateMutation.mutate({
      homeTeamId: values.homeTeamId || undefined,
      awayTeamId: values.awayTeamId || undefined,
      kickoffAt: new Date(values.kickoffAt).toISOString(),
      venue: values.venue || undefined,
    });
  };

  const isFinished = match.status === "FINISHED";
  const isCancelled = match.status === "CANCELLED";
  const isPostponed = match.status === "POSTPONED";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/partidos"
          className="inline-flex items-center gap-2 mb-3 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Volver a partidos
        </Link>
        <h1 className="font-[family-name:var(--font-landing-display)] text-3xl md:text-4xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Partido #{match.matchNumber}
        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
          {match.phase} · Estado actual:{" "}
          <span className="font-bold uppercase">{match.status}</span>
        </p>
      </div>

      <section className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6">
        <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Resumen
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
          <TeamSummary match={match} side="home" />
          <div className="flex flex-col items-center justify-center text-center">
            <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
              Resultado
            </p>
            {match.scoreHome !== null && match.scoreAway !== null ? (
              <p
                className="mt-1 font-[family-name:var(--font-landing-display)] tabular-nums leading-none text-[var(--color-landing-text)]"
                style={{ fontSize: "48px" }}
              >
                {match.scoreHome}
                <span className="mx-3 text-[var(--color-landing-text-muted)]">
                  -
                </span>
                {match.scoreAway}
              </p>
            ) : (
              <p
                className="mt-1 font-[family-name:var(--font-landing-display)] leading-none text-[var(--color-landing-text-muted)]"
                style={{ fontSize: "48px" }}
              >
                —
              </p>
            )}
            <p className="mt-2 font-sans text-xs text-[var(--color-landing-text-muted)]">
              {formatDateTime(match.kickoffAt)}
            </p>
          </div>
          <TeamSummary match={match} side="away" />
        </div>
      </section>

      <section className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6">
        <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Editar
        </h2>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2"
          noValidate
        >
          <div>
            <Label htmlFor="kickoffAt">Kickoff (local)</Label>
            <Input
              id="kickoffAt"
              type="datetime-local"
              {...form.register("kickoffAt")}
            />
            {form.formState.errors.kickoffAt ? (
              <p className="mt-1 font-sans text-xs text-[var(--color-landing-red)]">
                {form.formState.errors.kickoffAt.message}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="venue">Sede</Label>
            <Input id="venue" type="text" {...form.register("venue")} />
          </div>
          <div>
            <Label htmlFor="city">Ciudad (opcional)</Label>
            <Input id="city" type="text" {...form.register("city")} />
          </div>
          <div>
            <Label htmlFor="country">Pais (opcional)</Label>
            <Input id="country" type="text" {...form.register("country")} />
          </div>
          <TeamPickerField
            label="Equipo local"
            placeholderLabel={match.homeTeamLabel}
            teamId={form.watch("homeTeamId")}
            teamById={teamById}
            onOpen={() => setPickerSlot("home")}
            onClear={() =>
              form.setValue("homeTeamId", "", { shouldDirty: true })
            }
          />
          <TeamPickerField
            label="Equipo visitante"
            placeholderLabel={match.awayTeamLabel}
            teamId={form.watch("awayTeamId")}
            teamById={teamById}
            onOpen={() => setPickerSlot("away")}
            onClear={() =>
              form.setValue("awayTeamId", "", { shouldDirty: true })
            }
          />
          <div className="md:col-span-2 flex flex-wrap justify-end gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6">
        <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Acciones
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {!isFinished ? (
            <Button
              type="button"
              variant="accent"
              onClick={() => setScoreModalOpen(true)}
              disabled={isCancelled}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
              Cargar resultado
            </Button>
          ) : (
            <Button
              type="button"
              variant="outlined"
              onClick={() => setRecalcModalOpen(true)}
            >
              <Calculator className="mr-2 h-4 w-4" aria-hidden />
              Recalcular
            </Button>
          )}
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              const newDate = window.prompt(
                "Nueva fecha (YYYY-MM-DDTHH:MM, hora local):",
              );
              if (!newDate) return;
              postponeMutation.mutate(new Date(newDate).toISOString());
            }}
            disabled={isPostponed || isCancelled || isFinished}
          >
            <AlertTriangle className="mr-2 h-4 w-4" aria-hidden />
            Marcar pospuesto
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              if (window.confirm("Cancelar este partido?")) {
                cancelMutation.mutate();
              }
            }}
            disabled={isCancelled || isFinished}
          >
            <XCircle className="mr-2 h-4 w-4" aria-hidden />
            Cancelar partido
          </Button>
        </div>
      </section>

      <ScoreModal
        open={scoreModalOpen}
        onOpenChange={setScoreModalOpen}
        match={match}
        onConfirm={() => {
          qc.invalidateQueries({
            queryKey: queryKeys.admin.matches.detail(id),
          });
          qc.invalidateQueries({ queryKey: queryKeys.matches.all() });
          // Cerrar un partido cambia los puntos de las predictions →
          // el ranking debe refrescar inmediatamente, no esperar al
          // próximo poll de 60s.
          qc.invalidateQueries({ queryKey: queryKeys.leaderboard.all() });
          router.refresh();
        }}
      />
      <RecalcModal
        open={recalcModalOpen}
        onOpenChange={setRecalcModalOpen}
        matchId={id}
        match={match}
      />

      <TeamSelectModal
        open={pickerSlot !== null}
        onOpenChange={(o) => !o && setPickerSlot(null)}
        teams={teams}
        excludeTeamIds={
          pickerSlot === "home"
            ? [form.watch("awayTeamId") || ""].filter(Boolean)
            : pickerSlot === "away"
              ? [form.watch("homeTeamId") || ""].filter(Boolean)
              : []
        }
        selectedTeamId={
          pickerSlot === "home"
            ? form.watch("homeTeamId") || null
            : pickerSlot === "away"
              ? form.watch("awayTeamId") || null
              : null
        }
        onSelect={(t) => {
          if (pickerSlot === "home") {
            form.setValue("homeTeamId", t.id, { shouldDirty: true });
          } else if (pickerSlot === "away") {
            form.setValue("awayTeamId", t.id, { shouldDirty: true });
          }
          setPickerSlot(null);
        }}
        title={
          pickerSlot === "home"
            ? "Asignar equipo local"
            : pickerSlot === "away"
              ? "Asignar equipo visitante"
              : "Asignar equipo"
        }
      />
    </div>
  );
}

/**
 * Botón-card que abre el TeamSelectModal para el slot home/away.
 *
 *   - Si hay team asignado: muestra flag + nombre + botón "limpiar".
 *   - Si no hay team: muestra el `homeTeamLabel`/`awayTeamLabel` del
 *     match (ej "1A", "3CDFGH") como pista FIFA — ayuda al admin a
 *     saber a qué placeholder le tiene que asignar el team correcto.
 *
 * Reemplaza los inputs de texto crudos (que pedían cuids) por un
 * picker visual coherente con /especiales y EntrySwitcher.
 */
function TeamPickerField({
  label,
  placeholderLabel,
  teamId,
  teamById,
  onOpen,
  onClear,
}: {
  label: string;
  placeholderLabel: string | null;
  teamId: string | undefined;
  teamById: Map<string, Team>;
  onOpen: () => void;
  onClear: () => void;
}) {
  const team = teamId ? teamById.get(teamId) : null;
  return (
    <div>
      <Label>{label}</Label>
      <button
        type="button"
        onClick={onOpen}
        className="mt-1 flex w-full items-center gap-3 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] p-3 text-left transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
      >
        {team ? (
          <>
            <TeamFlag fifaCode={team.fifaCode} src={team.flagUrl} size={32} />
            <span className="flex-1 font-[family-name:var(--font-landing-display)] text-lg uppercase tracking-tight text-[var(--color-landing-text)]">
              {team.name}
            </span>
          </>
        ) : (
          <>
            <span
              className="h-8 w-8 shrink-0 rounded-sm bg-[var(--color-landing-bg)] border border-dashed border-[var(--color-landing-line)]"
              aria-hidden
            />
            <span className="flex-1 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
              {placeholderLabel
                ? `Slot FIFA: ${placeholderLabel} — asignar`
                : "Asignar equipo"}
            </span>
          </>
        )}
        <ChevronDown
          className="h-4 w-4 shrink-0 text-[var(--color-landing-text-muted)]"
          aria-hidden
        />
      </button>
      {team ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-red)] transition-colors"
        >
          Limpiar
        </button>
      ) : null}
    </div>
  );
}

function TeamSummary({
  match,
  side,
}: {
  match: Match;
  side: "home" | "away";
}) {
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  const label = side === "home" ? match.homeTeamLabel : match.awayTeamLabel;
  return (
    <div className="flex flex-col items-center text-center">
      {team ? (
        <>
          <TeamFlag fifaCode={team.fifaCode} src={team.flagUrl} size={48} />
          <p className="mt-2 font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight text-[var(--color-landing-text)]">
            {team.name}
          </p>
          <p className="font-sans text-xs text-[var(--color-landing-text-muted)]">
            {team.fifaCode}
          </p>
        </>
      ) : (
        <>
          <div className="h-12 w-12 rounded-sm border-2 border-dashed border-[var(--color-landing-line-strong)]" />
          <p className="mt-2 font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight text-[var(--color-landing-text-muted)]">
            {label ?? "TBD"}
          </p>
          <p className="font-sans text-xs text-[var(--color-landing-text-muted)]">
            Equipo aun no definido
          </p>
        </>
      )}
    </div>
  );
}

function ScoreModal({
  open,
  onOpenChange,
  match,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  match: Match;
  onConfirm: () => void;
}) {
  const [scoreHome, setScoreHome] = useState<number | null>(null);
  const [scoreAway, setScoreAway] = useState<number | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  const finishMutation = useMutation({
    mutationFn: () =>
      finishMatch(match.id, {
        scoreHome: scoreHome ?? 0,
        scoreAway: scoreAway ?? 0,
      }),
    onSuccess: () => {
      toast.success("Resultado cargado y puntos calculados");
      onConfirm();
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No se pudo cargar el resultado.");
    },
  });

  const reset = () => {
    setScoreHome(null);
    setScoreAway(null);
    setConfirmStep(false);
  };

  const canSubmit = scoreHome !== null && scoreAway !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cargar resultado</DialogTitle>
          <DialogDescription>
            Ingresa el resultado final. Esta accion dispara la cascada de
            scoring (recalculo de todas las predictions).
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid grid-cols-3 items-center gap-4">
          <div className="flex flex-col items-center">
            {match.homeTeam ? (
              <TeamFlag fifaCode={match.homeTeam.fifaCode} src={match.homeTeam.flagUrl} size={32} />
            ) : null}
            <p className="mt-2 font-[family-name:var(--font-landing-display)] text-base uppercase tracking-tight">
              {match.homeTeam?.shortName ?? match.homeTeamLabel ?? "TBD"}
            </p>
            <div className="mt-3">
              <PredictionInput
                value={scoreHome}
                onChange={setScoreHome}
                ariaLabel="Score local"
                className="!h-20 !w-20 !text-5xl"
              />
            </div>
          </div>
          <p className="text-center font-[family-name:var(--font-landing-display)] text-3xl font-black text-[var(--color-landing-text-muted)]">
            VS
          </p>
          <div className="flex flex-col items-center">
            {match.awayTeam ? (
              <TeamFlag fifaCode={match.awayTeam.fifaCode} src={match.awayTeam.flagUrl} size={32} />
            ) : null}
            <p className="mt-2 font-[family-name:var(--font-landing-display)] text-base uppercase tracking-tight">
              {match.awayTeam?.shortName ?? match.awayTeamLabel ?? "TBD"}
            </p>
            <div className="mt-3">
              <PredictionInput
                value={scoreAway}
                onChange={setScoreAway}
                ariaLabel="Score visitante"
                className="!h-20 !w-20 !text-5xl"
              />
            </div>
          </div>
        </div>

        {confirmStep ? (
          <div className="mt-4 rounded-sm border-2 border-[var(--color-landing-red)] bg-[var(--color-landing-surface)] p-3">
            <p className="font-sans text-sm font-bold text-[var(--color-landing-red)]">
              Una vez cargado, todas las predicciones se recalculan y el
              leaderboard cambia. Confirmas?
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancelar
          </Button>
          {confirmStep ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => finishMutation.mutate()}
              disabled={finishMutation.isPending}
            >
              {finishMutation.isPending
                ? "Calculando..."
                : "CONFIRMAR Y CALCULAR PUNTOS"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="accent"
              onClick={() => setConfirmStep(true)}
              disabled={!canSubmit}
            >
              Continuar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecalcModal({
  open,
  onOpenChange,
  matchId,
  match,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  matchId: string;
  match: Match;
}) {
  const qc = useQueryClient();
  const recalcMutation = useMutation({
    mutationFn: () => recalculateMatch(matchId),
    onSuccess: (res) => {
      toast.success(
        `Recalculo OK · ${res.predictionsAffected} predicciones`,
      );
      qc.invalidateQueries({
        queryKey: queryKeys.admin.matches.detail(matchId),
      });
      // Recalcular cambia los puntos → ranking debe refrescar.
      qc.invalidateQueries({ queryKey: queryKeys.leaderboard.all() });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No se pudo recalcular.");
    },
  });

  // TODO(backend): la fase puede estar "pagada" (premio entregado) — el
  // backend deberia devolver 409. Mientras tanto el modal solo muestra
  // un warning y deja al backend rechazar si corresponde.
  const phaseLockedHint =
    match.status === "FINISHED" ? null : "Solo disponible para partidos FINISHED";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recalcular resultado</DialogTitle>
          <DialogDescription>
            Vuelve a evaluar todas las predicciones de este partido con
            las reglas de scoring actuales. Util si se cambio una regla
            o se corrigio el resultado.
          </DialogDescription>
        </DialogHeader>
        {phaseLockedHint ? (
          <p
            className={cn(
              "rounded-sm border border-[var(--color-landing-red)] bg-[var(--color-landing-surface)] p-3",
              "font-sans text-xs text-[var(--color-landing-red)]",
            )}
          >
            {phaseLockedHint}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outlined"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => recalcMutation.mutate()}
            disabled={
              recalcMutation.isPending || match.status !== "FINISHED"
            }
          >
            {recalcMutation.isPending ? "Recalculando..." : "Recalcular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLocalDatetime(iso: string): string {
  // Convert ISO → "YYYY-MM-DDTHH:MM" local for <input type="datetime-local">.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

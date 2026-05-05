"use client";

import { use, useState } from "react";
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
  finishMatch,
  getAdminMatch,
  postponeMatch,
  recalculateMatch,
  updateMatch,
} from "@/lib/api/admin";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { Match } from "@/lib/api/types";

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

  const matchQuery = useQuery<Match>({
    queryKey: queryKeys.admin.matches.detail(id),
    queryFn: () => getAdminMatch(id),
    staleTime: 30_000,
  });

  const match = matchQuery.data;

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
    mutationFn: () => updateMatch(id, { status: "CANCELLED" }),
    onSuccess: () => {
      toast.success("Partido cancelado");
      qc.invalidateQueries({ queryKey: queryKeys.admin.matches.detail(id) });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos cancelar el partido.");
    },
  });

  if (matchQuery.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-busy="true">
        <div className="h-12 w-1/3 animate-pulse rounded bg-[var(--color-prode-surface)]" />
        <div className="h-64 animate-pulse rounded bg-[var(--color-prode-surface)]" />
      </div>
    );
  }
  if (!match) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-prode-border)] bg-white p-8 text-center">
        <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
          No encontramos el partido.
        </p>
        <Link
          href="/admin/partidos"
          className="mt-4 inline-flex items-center gap-2 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-near-black)] underline"
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
          className="inline-flex items-center gap-2 mb-3 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)]"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Volver a partidos
        </Link>
        <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          Partido #{match.matchNumber}
        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-prode-text-secondary)]">
          {match.phase} · Estado actual:{" "}
          <span className="font-bold uppercase">{match.status}</span>
        </p>
      </div>

      <section className="rounded-md border border-[var(--color-prode-border)] bg-white p-5 md:p-6">
        <h2 className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          Resumen
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
          <TeamSummary match={match} side="home" />
          <div className="flex flex-col items-center justify-center text-center">
            <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
              Resultado
            </p>
            {match.scoreHome !== null && match.scoreAway !== null ? (
              <p
                className="mt-1 font-display font-black tabular-nums leading-none text-[var(--color-prode-near-black)]"
                style={{ fontSize: "48px" }}
              >
                {match.scoreHome}
                <span className="mx-3 text-[var(--color-prode-text-secondary)]">
                  -
                </span>
                {match.scoreAway}
              </p>
            ) : (
              <p
                className="mt-1 font-display font-black leading-none text-[var(--color-prode-text-muted)]"
                style={{ fontSize: "48px" }}
              >
                —
              </p>
            )}
            <p className="mt-2 font-sans text-xs text-[var(--color-prode-text-secondary)]">
              {formatDateTime(match.kickoffAt)}
            </p>
          </div>
          <TeamSummary match={match} side="away" />
        </div>
      </section>

      <section className="rounded-md border border-[var(--color-prode-border)] bg-white p-5 md:p-6">
        <h2 className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
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
              <p className="mt-1 font-sans text-xs text-[var(--color-prode-accent)]">
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
          <div>
            <Label htmlFor="homeTeamId">ID equipo local</Label>
            <Input
              id="homeTeamId"
              type="text"
              placeholder={match.homeTeam?.id ?? "—"}
              {...form.register("homeTeamId")}
            />
          </div>
          <div>
            <Label htmlFor="awayTeamId">ID equipo visitante</Label>
            <Input
              id="awayTeamId"
              type="text"
              placeholder={match.awayTeam?.id ?? "—"}
              {...form.register("awayTeamId")}
            />
          </div>
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

      <section className="rounded-md border border-[var(--color-prode-border)] bg-white p-5 md:p-6">
        <h2 className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
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
          router.refresh();
        }}
      />
      <RecalcModal
        open={recalcModalOpen}
        onOpenChange={setRecalcModalOpen}
        matchId={id}
        match={match}
      />
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
          <TeamFlag fifaCode={team.fifaCode} size={48} />
          <p className="mt-2 font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
            {team.name}
          </p>
          <p className="font-sans text-xs text-[var(--color-prode-text-secondary)]">
            {team.fifaCode}
          </p>
        </>
      ) : (
        <>
          <div className="h-12 w-12 rounded-md border-2 border-dashed border-[var(--color-prode-border)]" />
          <p className="mt-2 font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-text-muted)]">
            {label ?? "TBD"}
          </p>
          <p className="font-sans text-xs text-[var(--color-prode-text-secondary)]">
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
              <TeamFlag fifaCode={match.homeTeam.fifaCode} size={32} />
            ) : null}
            <p className="mt-2 font-display text-base font-black uppercase tracking-wide">
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
          <p className="text-center font-display text-3xl font-black text-[var(--color-prode-text-secondary)]">
            VS
          </p>
          <div className="flex flex-col items-center">
            {match.awayTeam ? (
              <TeamFlag fifaCode={match.awayTeam.fifaCode} size={32} />
            ) : null}
            <p className="mt-2 font-display text-base font-black uppercase tracking-wide">
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
          <div className="mt-4 rounded-md border-2 border-[var(--color-prode-accent)] bg-[var(--color-prode-surface)] p-3">
            <p className="font-sans text-sm font-bold text-[var(--color-prode-accent)]">
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
              "rounded-md border border-[var(--color-prode-accent)] bg-[var(--color-prode-surface)] p-3",
              "font-sans text-xs text-[var(--color-prode-accent)]",
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

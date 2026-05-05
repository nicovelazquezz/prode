"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Lock, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TeamFlag } from "@/components/domain/team-flag";

// Lazy-load the team picker — only mounted when the user taps a team slot.
const TeamSelectModal = dynamic(
  () =>
    import("@/components/domain/team-select-modal").then(
      (m) => m.TeamSelectModal,
    ),
);
import { queryKeys } from "@/lib/api/queryKeys";
import { getMatchesByPhase } from "@/lib/api/matches";
import {
  getMySpecialPrediction,
  upsertSpecialPrediction,
} from "@/lib/api/predictions";
import type { SpecialPrediction, Team } from "@/lib/api/types";

const formSchema = z
  .object({
    championTeamId: z.string().min(1, "Elegi un campeon"),
    runnerUpTeamId: z.string().min(1, "Elegi un subcampeon"),
    thirdPlaceTeamId: z.string().min(1, "Elegi un tercer puesto"),
    topScorerName: z
      .string()
      .min(2, "Indica al menos 2 caracteres")
      .max(80, "Demasiado largo"),
    totalGoals: z
      .number({ message: "Indica un numero" })
      .int("Tiene que ser un entero")
      .min(0, "No puede ser negativo")
      .max(500, "Demasiado alto"),
  })
  .superRefine((vals, ctx) => {
    const ids = [
      vals.championTeamId,
      vals.runnerUpTeamId,
      vals.thirdPlaceTeamId,
    ];
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["thirdPlaceTeamId"],
        message: "Los 3 podios deben ser teams distintos",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

type Slot = "champion" | "runnerUp" | "thirdPlace";

export default function EspecialesPage() {
  // Existing prediction (read-only if locked).
  const specialQuery = useQuery({
    queryKey: queryKeys.predictions.special(),
    queryFn: () => getMySpecialPrediction(),
    staleTime: 30_000,
  });

  // Teams: derivamos del listado de matches de fase GROUPS (incluye
  // homeTeam / awayTeam con todas las relaciones).
  const matchesQuery = useQuery({
    queryKey: queryKeys.matches.byPhase("GROUPS"),
    queryFn: () => getMatchesByPhase("GROUPS"),
    staleTime: 5 * 60_000,
  });
  const teams = useMemo<Team[]>(() => {
    const map = new Map<string, Team>();
    for (const m of matchesQuery.data ?? []) {
      if (m.homeTeam) map.set(m.homeTeam.id, m.homeTeam);
      if (m.awayTeam) map.set(m.awayTeam.id, m.awayTeam);
    }
    return [...map.values()];
  }, [matchesQuery.data]);

  if (specialQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">
        <div className="space-y-4" aria-busy="true">
          <div className="h-10 w-2/3 bg-[var(--color-prode-surface)] rounded-md animate-pulse" />
          <div className="h-32 bg-[var(--color-prode-surface)] rounded-md animate-pulse" />
          <div className="h-32 bg-[var(--color-prode-surface)] rounded-md animate-pulse" />
        </div>
      </div>
    );
  }

  const existing = specialQuery.data;

  if (existing && existing.lockedAt !== null) {
    return (
      <ReadOnlyView
        special={existing}
        teams={teams}
        teamsLoading={matchesQuery.isLoading}
      />
    );
  }

  return (
    <EditableForm existing={existing} teams={teams} />
  );
}

// ─── Read-only view ─────────────────────────────────────────────

function ReadOnlyView({
  special,
  teams,
  teamsLoading,
}: {
  special: SpecialPrediction;
  teams: Team[];
  teamsLoading: boolean;
}) {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 flex flex-col gap-6">
      <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
        Predicciones especiales
      </h1>
      <div className="rounded-sm border-2 border-[var(--color-landing-green)] bg-[var(--color-prode-surface)] p-4 flex items-start gap-3">
        <Lock className="h-5 w-5 mt-0.5 shrink-0 text-[var(--color-prode-near-black)]" aria-hidden />
        <div>
          <p className="font-display text-base font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
            Confirmadas
          </p>
          <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
            Tus elecciones quedaron bloqueadas y no se pueden modificar.
          </p>
        </div>
      </div>
      <ReadOnlyRow
        label="Campeon"
        team={
          special.championTeam ??
          (special.championTeamId
            ? teamById.get(special.championTeamId) ?? null
            : null)
        }
        loading={teamsLoading}
      />
      <ReadOnlyRow
        label="Subcampeon"
        team={
          special.runnerUpTeam ??
          (special.runnerUpTeamId
            ? teamById.get(special.runnerUpTeamId) ?? null
            : null)
        }
        loading={teamsLoading}
      />
      <ReadOnlyRow
        label="Tercer puesto"
        team={
          special.thirdPlaceTeam ??
          (special.thirdPlaceTeamId
            ? teamById.get(special.thirdPlaceTeamId) ?? null
            : null)
        }
        loading={teamsLoading}
      />
      <div className="rounded-sm border border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] p-4">
        <p className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
          Goleador
        </p>
        <p className="mt-1 font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          {special.topScorer?.fullName ?? special.topScorerName ?? "—"}
        </p>
      </div>
      <div className="rounded-sm border border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] p-4">
        <p className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
          Total de goles del torneo
        </p>
        <p className="mt-1 font-display text-2xl font-black tabular-nums text-[var(--color-prode-near-black)]">
          {special.totalGoals ?? "—"}
        </p>
      </div>
    </div>
  );
}

function ReadOnlyRow({
  label,
  team,
  loading,
}: {
  label: string;
  team: Team | null;
  loading: boolean;
}) {
  return (
    <div className="rounded-sm border border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] p-4 flex items-center gap-4">
      <div className="flex-1">
        <p className="font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
          {label}
        </p>
        <p className="mt-1 font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          {team ? team.name : loading ? "Cargando..." : "—"}
        </p>
      </div>
      {team ? <TeamFlag fifaCode={team.fifaCode} size={48} /> : null}
    </div>
  );
}

// ─── Editable form ──────────────────────────────────────────────

function EditableForm({
  existing,
  teams,
}: {
  existing: SpecialPrediction | null | undefined;
  teams: Team[];
}) {
  const queryClient = useQueryClient();
  const [openSlot, setOpenSlot] = useState<Slot | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
    trigger,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      championTeamId: existing?.championTeamId ?? "",
      runnerUpTeamId: existing?.runnerUpTeamId ?? "",
      thirdPlaceTeamId: existing?.thirdPlaceTeamId ?? "",
      topScorerName: existing?.topScorerName ?? "",
      totalGoals: existing?.totalGoals ?? 0,
    },
  });

  const watchedChampion = watch("championTeamId");
  const watchedRunnerUp = watch("runnerUpTeamId");
  const watchedThird = watch("thirdPlaceTeamId");

  const teamById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  );

  const upsertMutation = useMutation({
    mutationFn: (vals: FormValues) =>
      upsertSpecialPrediction({
        championTeamId: vals.championTeamId,
        runnerUpTeamId: vals.runnerUpTeamId,
        thirdPlaceTeamId: vals.thirdPlaceTeamId,
        topScorerName: vals.topScorerName,
        topScorerId: null,
        totalGoals: vals.totalGoals,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.predictions.special(), data);
      queryClient.invalidateQueries({
        queryKey: queryKeys.predictions.special(),
      });
      toast.success("Predicciones especiales guardadas");
      setConfirmOpen(false);
    },
  });

  const onSubmit = (vals: FormValues) => {
    setPendingValues(vals);
    setConfirmOpen(true);
  };

  const onConfirm = () => {
    if (!pendingValues) return;
    upsertMutation.mutate(pendingValues);
  };

  const slotMeta: Record<Slot, { label: string; field: keyof FormValues }> = {
    champion: { label: "Campeon", field: "championTeamId" },
    runnerUp: { label: "Subcampeon", field: "runnerUpTeamId" },
    thirdPlace: { label: "Tercer puesto", field: "thirdPlaceTeamId" },
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 flex flex-col gap-6">
      <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
        Predicciones especiales
      </h1>

      {/* Banner permanente accent */}
      <div
        role="alert"
        className="rounded-sm bg-[var(--color-landing-red)] text-[var(--color-landing-text)] p-4 flex items-start gap-3"
      >
        <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" aria-hidden />
        <p className="font-sans text-sm">
          <span className="font-bold uppercase tracking-wider">Atencion: </span>
          Una vez confirmadas, no podras modificarlas despues del 11/06.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
        noValidate
      >
        {(["champion", "runnerUp", "thirdPlace"] as Slot[]).map((slot) => {
          const meta = slotMeta[slot];
          const teamId = watch(meta.field) as string;
          const team = teamId ? teamById.get(teamId) : undefined;
          return (
            <div key={slot} className="flex flex-col gap-2">
              <Label>{meta.label}</Label>
              <button
                type="button"
                onClick={() => setOpenSlot(slot)}
                className="rounded-sm border border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] p-4 flex items-center gap-3 text-left hover:border-[var(--color-prode-near-black)] transition-colors"
              >
                {team ? (
                  <TeamFlag fifaCode={team.fifaCode} size={32} />
                ) : (
                  <span className="w-8 h-8 rounded-sm bg-[var(--color-prode-surface)]" aria-hidden />
                )}
                <span
                  className={
                    "flex-1 font-display text-lg font-black uppercase tracking-wide " +
                    (team
                      ? "text-[var(--color-prode-near-black)]"
                      : "text-[var(--color-prode-text-muted)]")
                  }
                >
                  {team ? team.name : "Elegi un team"}
                </span>
                <ChevronDown
                  className="h-4 w-4 text-[var(--color-prode-text-secondary)]"
                  aria-hidden
                />
              </button>
              {errors[meta.field] ? (
                <p className="font-sans text-xs text-[var(--color-prode-accent)]">
                  {String(errors[meta.field]?.message ?? "")}
                </p>
              ) : null}
            </div>
          );
        })}

        {/* Goleador (free text) */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="topScorerName">Goleador del torneo</Label>
          <Controller
            control={control}
            name="topScorerName"
            render={({ field }) => (
              <Input
                id="topScorerName"
                placeholder="Ej. Lionel Messi"
                {...field}
              />
            )}
          />
          {errors.topScorerName ? (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {errors.topScorerName.message}
            </p>
          ) : null}
        </div>

        {/* Total goles */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="totalGoals">Total de goles del torneo</Label>
          <Controller
            control={control}
            name="totalGoals"
            render={({ field }) => (
              <Input
                id="totalGoals"
                type="number"
                inputMode="numeric"
                min={0}
                max={500}
                value={Number.isNaN(field.value) ? "" : field.value}
                onChange={(e) => {
                  const raw = e.target.value;
                  field.onChange(raw === "" ? 0 : Number.parseInt(raw, 10));
                }}
              />
            )}
          />
          {errors.totalGoals ? (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {errors.totalGoals.message}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={isSubmitting || upsertMutation.isPending}
        >
          {existing ? "Actualizar" : "Guardar"}
        </Button>
      </form>

      {/* Modales de seleccion (uno por slot) */}
      {(["champion", "runnerUp", "thirdPlace"] as Slot[]).map((slot) => {
        const meta = slotMeta[slot];
        const otherIds = [
          slot !== "champion" ? watchedChampion : "",
          slot !== "runnerUp" ? watchedRunnerUp : "",
          slot !== "thirdPlace" ? watchedThird : "",
        ].filter(Boolean) as string[];
        const currentId = watch(meta.field) as string;
        return (
          <TeamSelectModal
            key={slot}
            open={openSlot === slot}
            onOpenChange={(o) => setOpenSlot(o ? slot : null)}
            teams={teams}
            excludeTeamIds={otherIds}
            selectedTeamId={currentId || null}
            onSelect={(t) => {
              setValue(meta.field, t.id, { shouldDirty: true });
              // Re-trigger validation in case dupes existed.
              trigger();
            }}
            title={`Elegi: ${meta.label}`}
          />
        );
      })}

      {/* Confirmacion final */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogTitle>Confirmar elecciones</DialogTitle>
          <DialogDescription>
            Revisa antes de guardar. Estas elecciones no podran cambiarse
            despues del 11/06.
          </DialogDescription>
          {pendingValues ? (
            <ul className="flex flex-col gap-2 font-sans text-sm">
              <ConfirmRow
                label="Campeon"
                value={teamById.get(pendingValues.championTeamId)?.name ?? "—"}
              />
              <ConfirmRow
                label="Subcampeon"
                value={teamById.get(pendingValues.runnerUpTeamId)?.name ?? "—"}
              />
              <ConfirmRow
                label="Tercer puesto"
                value={teamById.get(pendingValues.thirdPlaceTeamId)?.name ?? "—"}
              />
              <ConfirmRow
                label="Goleador"
                value={pendingValues.topScorerName}
              />
              <ConfirmRow
                label="Total de goles"
                value={String(pendingValues.totalGoals)}
              />
            </ul>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={upsertMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={onConfirm}
              disabled={upsertMutation.isPending}
            >
              {upsertMutation.isPending ? "Guardando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-[var(--color-prode-border)] pb-2 last:border-0">
      <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
        {label}
      </span>
      <span className="font-display text-base font-black uppercase tracking-wide text-[var(--color-prode-near-black)] truncate">
        {value}
      </span>
    </li>
  );
}

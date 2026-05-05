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
  getEntrySpecialPrediction,
  upsertEntrySpecialPrediction,
} from "@/lib/api/predictions";
import type { SpecialPrediction, Team } from "@/lib/api/types";
import { useActiveEntry } from "@/lib/hooks/use-active-entry";
import { cn } from "@/lib/utils/cn";

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

const labelClasses =
  "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]";

const inputClasses =
  "h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] focus:border-[var(--color-landing-green)]";

const errorText =
  "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-red)]";

const cardSurface =
  "rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5";

const buttonPrimary =
  "inline-flex items-center justify-center rounded-sm bg-[var(--color-landing-red)] px-6 py-4 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] disabled:cursor-not-allowed disabled:opacity-40";

const buttonOutlined =
  "inline-flex items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

const heroHeader = (
  <header>
    <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
      Predicciones especiales
    </div>
    <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">
      <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
        Podio &amp; goles.
      </span>
    </h1>
  </header>
);

export default function EspecialesPage() {
  const { activeEntry } = useActiveEntry();
  const entryId = activeEntry?.id ?? "";

  const specialQuery = useQuery({
    queryKey: queryKeys.entries.special(entryId),
    queryFn: () => getEntrySpecialPrediction(entryId),
    enabled: !!entryId,
    staleTime: 30_000,
  });

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

  if (specialQuery.isLoading || !entryId) {
    return (
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-10 md:px-8 md:pb-24 md:pt-14">
        <div className="space-y-4" aria-busy="true">
          <div className="h-12 w-2/3 rounded-sm bg-[var(--color-landing-surface)] animate-pulse" />
          <div className="h-32 rounded-sm bg-[var(--color-landing-surface)] animate-pulse" />
          <div className="h-32 rounded-sm bg-[var(--color-landing-surface)] animate-pulse" />
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

  return <EditableForm entryId={entryId} existing={existing} teams={teams} />;
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
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-10 md:px-8 md:pb-24 md:pt-14 flex flex-col gap-6">
      {heroHeader}
      <div className="flex items-start gap-3 rounded-sm border-2 border-[var(--color-landing-green)] bg-[var(--color-landing-surface)] p-4">
        <Lock
          className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-landing-green)]"
          aria-hidden
        />
        <div>
          <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text)]">
            Confirmadas
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-landing-text-muted)]">
            Tus elecciones quedaron bloqueadas y no se pueden modificar.
          </p>
        </div>
      </div>
      <ReadOnlyRow
        label="Campeón"
        accent="gold"
        team={
          special.championTeam ??
          (special.championTeamId
            ? teamById.get(special.championTeamId) ?? null
            : null)
        }
        loading={teamsLoading}
      />
      <ReadOnlyRow
        label="Subcampeón"
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
        accent="green"
        team={
          special.thirdPlaceTeam ??
          (special.thirdPlaceTeamId
            ? teamById.get(special.thirdPlaceTeamId) ?? null
            : null)
        }
        loading={teamsLoading}
      />
      <div className={cardSurface}>
        <p className={labelClasses}>Goleador</p>
        <p className="mt-2 font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight leading-none text-[var(--color-landing-text)]">
          {special.topScorer?.fullName ?? special.topScorerName ?? "—"}
        </p>
      </div>
      <div className={cardSurface}>
        <p className={labelClasses}>Total de goles del torneo</p>
        <p className="mt-2 font-[family-name:var(--font-landing-display)] text-3xl tabular-nums leading-none text-[var(--color-landing-gold)]">
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
  accent,
}: {
  label: string;
  team: Team | null;
  loading: boolean;
  accent?: "gold" | "green";
}) {
  const accentColor =
    accent === "gold"
      ? "var(--color-landing-gold)"
      : accent === "green"
        ? "var(--color-landing-green)"
        : undefined;
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 border-l-[3px]",
      )}
      style={accentColor ? { borderLeftColor: accentColor } : undefined}
    >
      <div className="flex-1 min-w-0">
        <p className={labelClasses}>{label}</p>
        <p className="mt-2 font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight leading-none text-[var(--color-landing-text)] truncate">
          {team ? team.name : loading ? "Cargando..." : "—"}
        </p>
      </div>
      {team ? <TeamFlag fifaCode={team.fifaCode} size={48} /> : null}
    </div>
  );
}

// ─── Editable form ──────────────────────────────────────────────

function EditableForm({
  entryId,
  existing,
  teams,
}: {
  entryId: string;
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
      upsertEntrySpecialPrediction(entryId, {
        championTeamId: vals.championTeamId,
        runnerUpTeamId: vals.runnerUpTeamId,
        thirdPlaceTeamId: vals.thirdPlaceTeamId,
        topScorerName: vals.topScorerName,
        topScorerId: null,
        totalGoals: vals.totalGoals,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.entries.special(entryId), data);
      queryClient.invalidateQueries({
        queryKey: queryKeys.entries.special(entryId),
      });
      // Refrescar también el resumen del entry (totalPoints, etc.)
      queryClient.invalidateQueries({ queryKey: queryKeys.entries.me() });
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

  const slotMeta: Record<
    Slot,
    { label: string; field: keyof FormValues; accent?: string }
  > = {
    champion: {
      label: "Campeón",
      field: "championTeamId",
      accent: "var(--color-landing-gold)",
    },
    runnerUp: { label: "Subcampeón", field: "runnerUpTeamId" },
    thirdPlace: {
      label: "Tercer puesto",
      field: "thirdPlaceTeamId",
      accent: "var(--color-landing-green)",
    },
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-10 md:px-8 md:pb-24 md:pt-14 flex flex-col gap-7">
      {heroHeader}

      <div
        role="alert"
        className="flex items-start gap-3 rounded-sm bg-[var(--color-landing-red)] p-4 text-[var(--color-landing-text)]"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p className="text-sm leading-relaxed">
          <span className="font-[family-name:var(--font-landing-mono)] uppercase tracking-[0.16em] font-bold">
            Atención:{" "}
          </span>
          Una vez confirmadas, no podrás modificarlas después del 11/06.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-5"
        noValidate
      >
        {(["champion", "runnerUp", "thirdPlace"] as Slot[]).map((slot) => {
          const meta = slotMeta[slot];
          const teamId = watch(meta.field) as string;
          const team = teamId ? teamById.get(teamId) : undefined;
          return (
            <div key={slot} className="flex flex-col gap-2">
              <label className={labelClasses}>{meta.label}</label>
              <button
                type="button"
                onClick={() => setOpenSlot(slot)}
                className="flex items-center gap-3 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-4 text-left transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] border-l-[3px]"
                style={
                  meta.accent ? { borderLeftColor: meta.accent } : undefined
                }
              >
                {team ? (
                  <TeamFlag fifaCode={team.fifaCode} size={32} />
                ) : (
                  <span
                    className="h-8 w-8 rounded-sm bg-[var(--color-landing-surface-2)]"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "flex-1 font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight leading-none",
                    team
                      ? "text-[var(--color-landing-text)]"
                      : "text-[var(--color-landing-text-muted)]",
                  )}
                >
                  {team ? team.name : "Elegí un team"}
                </span>
                <ChevronDown
                  className="h-4 w-4 text-[var(--color-landing-text-muted)]"
                  aria-hidden
                />
              </button>
              {errors[meta.field] ? (
                <p className={errorText}>
                  {String(errors[meta.field]?.message ?? "")}
                </p>
              ) : null}
            </div>
          );
        })}

        <div className="flex flex-col gap-2">
          <label htmlFor="topScorerName" className={labelClasses}>
            Goleador del torneo
          </label>
          <Controller
            control={control}
            name="topScorerName"
            render={({ field }) => (
              <input
                id="topScorerName"
                placeholder="Ej. Lionel Messi"
                className={inputClasses}
                {...field}
              />
            )}
          />
          {errors.topScorerName ? (
            <p className={errorText}>{errors.topScorerName.message}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="totalGoals" className={labelClasses}>
            Total de goles del torneo
          </label>
          <Controller
            control={control}
            name="totalGoals"
            render={({ field }) => (
              <input
                id="totalGoals"
                type="number"
                inputMode="numeric"
                min={0}
                max={500}
                className={inputClasses}
                value={Number.isNaN(field.value) ? "" : field.value}
                onChange={(e) => {
                  const raw = e.target.value;
                  field.onChange(raw === "" ? 0 : Number.parseInt(raw, 10));
                }}
              />
            )}
          />
          {errors.totalGoals ? (
            <p className={errorText}>{errors.totalGoals.message}</p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isSubmitting || upsertMutation.isPending}
          className={cn(buttonPrimary, "w-full")}
        >
          {existing ? "Actualizar" : "Guardar"}
        </button>
      </form>

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
              trigger();
            }}
            title={`Elegí: ${meta.label}`}
          />
        );
      })}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogTitle className="font-[family-name:var(--font-landing-display)] text-3xl uppercase tracking-tight text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[4px] border-[var(--color-landing-green)] pb-1">
              Confirmar elecciones
            </span>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            Revisá antes de guardar. Estas elecciones no podrán cambiarse
            después del 11/06.
          </DialogDescription>
          {pendingValues ? (
            <ul className="mt-4 flex flex-col gap-3 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] p-4">
              <ConfirmRow
                label="Campeón"
                value={teamById.get(pendingValues.championTeamId)?.name ?? "—"}
              />
              <ConfirmRow
                label="Subcampeón"
                value={teamById.get(pendingValues.runnerUpTeamId)?.name ?? "—"}
              />
              <ConfirmRow
                label="Tercer puesto"
                value={
                  teamById.get(pendingValues.thirdPlaceTeamId)?.name ?? "—"
                }
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
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-stretch">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={upsertMutation.isPending}
              className={cn(buttonOutlined, "flex-1 disabled:opacity-40")}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={upsertMutation.isPending}
              className={cn(buttonPrimary, "flex-1")}
            >
              {upsertMutation.isPending ? "Guardando..." : "Confirmar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-[var(--color-landing-line)] pb-2 last:border-0">
      <span className={labelClasses}>{label}</span>
      <span className="font-[family-name:var(--font-landing-display)] text-base uppercase tracking-tight text-[var(--color-landing-text)] truncate">
        {value}
      </span>
    </li>
  );
}

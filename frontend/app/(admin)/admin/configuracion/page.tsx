"use client";

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import {
  listConfig,
  listPhaseMultipliers,
  listScoringRules,
  listSpecialPrizeRules,
  updateConfig,
  updatePhaseMultiplier,
  updateScoringRule,
  updateSpecialPrizeRule,
  type PhaseMultiplierEntry,
  type ScoringRuleEntry,
  type SpecialPrizeRuleEntry,
  type AppConfigEntry,
} from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/queryKeys";
import { formatDateTime } from "@/lib/utils/format";
import type { OutcomeType, Phase } from "@/lib/api/types";

const OUTCOME_LABELS: Record<OutcomeType, string> = {
  EXACT: "Resultado exacto",
  WINNER_AND_DIFF: "Ganador + diferencia",
  DRAW_DIFFERENT: "Empate (resultado distinto)",
  WINNER_ONLY: "Solo ganador",
  MISS: "Errado",
};

const PHASE_LABELS: Record<Phase, string> = {
  GROUPS: "Fase de grupos",
  ROUND_32: "16avos",
  ROUND_16: "Octavos",
  QUARTERS: "Cuartos",
  SEMIS: "Semifinales",
  THIRD_PLACE: "Tercer puesto",
  FINAL: "Final",
};

const SPECIAL_LABELS: Record<SpecialPrizeRuleEntry["key"], string> = {
  champion: "Campeón",
  runnerUp: "Subcampeón",
  thirdPlace: "Tercer puesto",
  topScorer: "Goleador del torneo",
  totalGoalsExact: "Total de goles · exacto",
  totalGoalsClose: "Total de goles · ±5",
};

const APP_CONFIG_LABELS: Record<string, string> = {
  REGISTRATION_PRICE: "Precio inscripcion (ARS)",
  REGISTRATION_DEADLINE: "Fecha cierre de inscripcion (ISO)",
  PRIZE_DISTRIBUTION_FIRST: "Distribucion pozo · 1ro (%)",
  PRIZE_DISTRIBUTION_SECOND: "Distribucion pozo · 2do (%)",
  PRIZE_DISTRIBUTION_THIRD: "Distribucion pozo · 3ro (%)",
  PHASE_PRIZE_AMOUNT: "Premio por fase (ARS)",
};

/**
 * /admin/configuracion (spec §6.11). Cada bloque (ScoringRule,
 * PhaseMultiplier, SpecialPrizeRule, AppConfig) en su propia Card
 * con form RHF y boton Save por seccion.
 *
 * Mobile responsive: cards se apilan, grilla interna 1 col mobile,
 * 2 cols md+.
 */
export default function AdminConfiguracionPage() {
  const scoringQuery = useQuery({
    queryKey: ["admin", "scoring-rules"] as const,
    queryFn: () => listScoringRules(),
    retry: false,
  });
  const phaseQuery = useQuery({
    queryKey: ["admin", "phase-multipliers"] as const,
    queryFn: () => listPhaseMultipliers(),
    retry: false,
  });
  const specialQuery = useQuery({
    queryKey: ["admin", "special-prize-rules"] as const,
    queryFn: () => listSpecialPrizeRules(),
    retry: false,
  });
  const configQuery = useQuery({
    queryKey: queryKeys.admin.config(),
    queryFn: () => listConfig(),
    retry: false,
  });

  return (
    <div className="space-y-8">
      <header>
        <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">Reglas del torneo</div>

        <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">

          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">

            Configuracion

          </span>

        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
          Reglas de scoring, multipliers por fase, premios especiales y
          parametros generales. Cada cambio queda registrado en auditoria.
        </p>
      </header>

      <ScoringRulesCard
        rules={scoringQuery.data ?? defaultScoringRules()}
        loading={scoringQuery.isLoading}
        hasData={!!scoringQuery.data}
      />
      <PhaseMultipliersCard
        multipliers={phaseQuery.data ?? defaultPhaseMultipliers()}
        loading={phaseQuery.isLoading}
        hasData={!!phaseQuery.data}
      />
      <SpecialPrizeRulesCard
        rules={specialQuery.data ?? defaultSpecialRules()}
        loading={specialQuery.isLoading}
        hasData={!!specialQuery.data}
      />
      <AppConfigCard
        entries={configQuery.data ?? []}
        loading={configQuery.isLoading}
        hasData={!!configQuery.data}
      />
    </div>
  );
}

function ScoringRulesCard({
  rules,
  loading,
  hasData,
}: {
  rules: ScoringRuleEntry[];
  loading: boolean;
  hasData: boolean;
}) {
  type Form = Record<OutcomeType, number>;
  const qc = useQueryClient();
  const form = useForm<Form>({
    defaultValues: rules.reduce<Partial<Form>>((acc, r) => {
      acc[r.outcomeType] = r.basePoints;
      return acc;
    }, {}) as Form,
  });

  // Reset cuando llegan datos del backend (placeholder → real).
  useEffect(() => {
    form.reset(
      rules.reduce<Partial<Form>>((acc, r) => {
        acc[r.outcomeType] = r.basePoints;
        return acc;
      }, {}) as Form,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData]);

  const updateMutation = useMutation({
    mutationFn: ({
      outcomeType,
      basePoints,
    }: {
      outcomeType: OutcomeType;
      basePoints: number;
    }) => updateScoringRule(outcomeType, basePoints),
    onSuccess: () => {
      toast.success("Regla guardada");
      qc.invalidateQueries({ queryKey: ["admin", "scoring-rules"] });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos guardar la regla.");
    },
  });

  const onSubmit = (values: Form) => {
    rules.forEach((rule) => {
      const next = Number(values[rule.outcomeType]);
      if (Number.isFinite(next) && next !== rule.basePoints) {
        updateMutation.mutate({
          outcomeType: rule.outcomeType,
          basePoints: next,
        });
      }
    });
  };

  return (
    <ConfigCard
      title="Reglas de scoring"
      description="Puntos base por tipo de acierto. Estos numeros se multiplican luego por el multiplier de la fase."
      loading={loading}
      hasData={hasData}
      endpoint="/admin/scoring-rules"
    >
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid grid-cols-1 gap-6 md:grid-cols-2"
        noValidate
      >
        {rules.map((rule) => (
          <div key={rule.outcomeType}>
            <Label htmlFor={`sr-${rule.outcomeType}`}>
              {OUTCOME_LABELS[rule.outcomeType]}
            </Label>
            <Input
              id={`sr-${rule.outcomeType}`}
              type="number"
              inputMode="numeric"
              {...form.register(rule.outcomeType, { valueAsNumber: true })}
            />
            <UpdatedFootnote
              updatedAt={rule.updatedAt}
              updatedBy={rule.updatedBy}
            />
          </div>
        ))}
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            <Save className="mr-2 h-4 w-4" aria-hidden />
            Guardar reglas
          </Button>
        </div>
      </form>
    </ConfigCard>
  );
}

function PhaseMultipliersCard({
  multipliers,
  loading,
  hasData,
}: {
  multipliers: PhaseMultiplierEntry[];
  loading: boolean;
  hasData: boolean;
}) {
  type Form = Record<Phase, number>;
  const qc = useQueryClient();
  const form = useForm<Form>({
    defaultValues: multipliers.reduce<Partial<Form>>((acc, m) => {
      acc[m.phase] = m.multiplier;
      return acc;
    }, {}) as Form,
  });

  useEffect(() => {
    form.reset(
      multipliers.reduce<Partial<Form>>((acc, m) => {
        acc[m.phase] = m.multiplier;
        return acc;
      }, {}) as Form,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData]);

  const updateMutation = useMutation({
    mutationFn: ({ phase, multiplier }: { phase: Phase; multiplier: number }) =>
      updatePhaseMultiplier(phase, multiplier),
    onSuccess: () => {
      toast.success("Multiplier guardado");
      qc.invalidateQueries({ queryKey: ["admin", "phase-multipliers"] });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos guardar.");
    },
  });

  const onSubmit = (values: Form) => {
    multipliers.forEach((m) => {
      const next = Number(values[m.phase]);
      if (Number.isFinite(next) && next !== m.multiplier) {
        updateMutation.mutate({ phase: m.phase, multiplier: next });
      }
    });
  };

  return (
    <ConfigCard
      title="Multipliers por fase"
      description="Factor que multiplica los puntos base segun la fase. Ej: GROUPS = 1, FINAL = 5."
      loading={loading}
      hasData={hasData}
      endpoint="/admin/phase-multipliers"
    >
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid grid-cols-1 gap-6 md:grid-cols-2"
        noValidate
      >
        {multipliers.map((m) => (
          <div key={m.phase}>
            <Label htmlFor={`pm-${m.phase}`}>{PHASE_LABELS[m.phase]}</Label>
            <Input
              id={`pm-${m.phase}`}
              type="number"
              step="0.1"
              inputMode="decimal"
              {...form.register(m.phase, { valueAsNumber: true })}
            />
            <UpdatedFootnote updatedAt={m.updatedAt} updatedBy={m.updatedBy} />
          </div>
        ))}
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            <Save className="mr-2 h-4 w-4" aria-hidden />
            Guardar multipliers
          </Button>
        </div>
      </form>
    </ConfigCard>
  );
}

function SpecialPrizeRulesCard({
  rules,
  loading,
  hasData,
}: {
  rules: SpecialPrizeRuleEntry[];
  loading: boolean;
  hasData: boolean;
}) {
  type Form = Record<SpecialPrizeRuleEntry["key"], number>;
  const qc = useQueryClient();
  const form = useForm<Form>({
    defaultValues: rules.reduce<Partial<Form>>((acc, r) => {
      acc[r.key] = r.points;
      return acc;
    }, {}) as Form,
  });

  useEffect(() => {
    form.reset(
      rules.reduce<Partial<Form>>((acc, r) => {
        acc[r.key] = r.points;
        return acc;
      }, {}) as Form,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData]);

  const updateMutation = useMutation({
    mutationFn: ({
      key,
      points,
    }: {
      key: SpecialPrizeRuleEntry["key"];
      points: number;
    }) => updateSpecialPrizeRule(key, points),
    onSuccess: () => {
      toast.success("Premio especial guardado");
      qc.invalidateQueries({ queryKey: ["admin", "special-prize-rules"] });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos guardar.");
    },
  });

  const onSubmit = (values: Form) => {
    rules.forEach((r) => {
      const next = Number(values[r.key]);
      if (Number.isFinite(next) && next !== r.points) {
        updateMutation.mutate({ key: r.key, points: next });
      }
    });
  };

  return (
    <ConfigCard
      title="Premios especiales"
      description="Puntos extras por aciertos especiales (campeon, goleador, etc.)."
      loading={loading}
      hasData={hasData}
      endpoint="/admin/special-prize-rules"
    >
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid grid-cols-1 gap-6 md:grid-cols-2"
        noValidate
      >
        {rules.map((r) => (
          <div key={r.key}>
            <Label htmlFor={`sp-${r.key}`}>{SPECIAL_LABELS[r.key]}</Label>
            <Input
              id={`sp-${r.key}`}
              type="number"
              inputMode="numeric"
              {...form.register(r.key, { valueAsNumber: true })}
            />
            <UpdatedFootnote updatedAt={r.updatedAt} updatedBy={r.updatedBy} />
          </div>
        ))}
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            <Save className="mr-2 h-4 w-4" aria-hidden />
            Guardar premios
          </Button>
        </div>
      </form>
    </ConfigCard>
  );
}

function AppConfigCard({
  entries,
  loading,
  hasData,
}: {
  entries: AppConfigEntry[];
  loading: boolean;
  hasData: boolean;
}) {
  const qc = useQueryClient();
  const form = useForm<Record<string, string>>({
    defaultValues: entries.reduce<Record<string, string>>((acc, e) => {
      acc[e.key] = e.value;
      return acc;
    }, {}),
  });

  useEffect(() => {
    form.reset(
      entries.reduce<Record<string, string>>((acc, e) => {
        acc[e.key] = e.value;
        return acc;
      }, {}),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, entries.length]);

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      updateConfig(key, value),
    onSuccess: () => {
      toast.success("Config guardada");
      qc.invalidateQueries({ queryKey: queryKeys.admin.config() });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos guardar.");
    },
  });

  const onSubmit = (values: Record<string, string>) => {
    entries.forEach((e) => {
      if (values[e.key] !== e.value) {
        updateMutation.mutate({ key: e.key, value: values[e.key] ?? "" });
      }
    });
  };

  return (
    <ConfigCard
      title="Parametros generales"
      description="Precio de inscripcion, fechas, distribucion del pozo. Llaves dinamicas."
      loading={loading}
      hasData={hasData}
      endpoint="/admin/config"
    >
      {entries.length === 0 ? (
        <p className="font-sans text-sm italic text-[var(--color-landing-text-muted)]">
          Sin parametros cargados todavia.
        </p>
      ) : (
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid grid-cols-1 gap-6 md:grid-cols-2"
          noValidate
        >
          {entries.map((e) => (
            <div key={e.key}>
              <Label htmlFor={`cfg-${e.key}`}>
                {APP_CONFIG_LABELS[e.key] ?? e.key}
              </Label>
              <Input id={`cfg-${e.key}`} type="text" {...form.register(e.key)} />
              {e.description ? (
                <p className="mt-1 font-sans text-xs text-[var(--color-landing-text-muted)]">
                  {e.description}
                </p>
              ) : null}
              <UpdatedFootnote updatedAt={e.updatedAt} updatedBy={e.updatedBy} />
            </div>
          ))}
          <div className="md:col-span-2 flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={updateMutation.isPending}
            >
              <Save className="mr-2 h-4 w-4" aria-hidden />
              Guardar parametros
            </Button>
          </div>
        </form>
      )}
    </ConfigCard>
  );
}

function ConfigCard({
  title,
  description,
  loading,
  hasData,
  endpoint,
  children,
}: {
  title: string;
  description: string;
  loading: boolean;
  hasData: boolean;
  endpoint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6">
      <header>
        <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          {title}
        </h2>
        <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
          {description}
        </p>
      </header>
      {!loading && !hasData ? (
        <p className="mt-4 rounded-sm border border-dashed border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-3 font-sans text-xs text-[var(--color-landing-text-muted)]">
          Endpoint <code className="font-mono">{endpoint}</code> no disponible —
          mostrando valores por defecto. Las ediciones quedan en el form pero
          no se persisten hasta que el backend tenga el endpoint.
        </p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function UpdatedFootnote({
  updatedAt,
  updatedBy,
}: {
  updatedAt: string | null | undefined;
  updatedBy: string | null;
}) {
  if (!updatedAt && !updatedBy) return null;
  return (
    <p className="mt-1 font-sans text-[10px] uppercase tracking-wider text-[var(--color-landing-text-muted)]">
      Editado{updatedAt ? ` ${formatDateTime(updatedAt)}` : ""}
      {updatedBy ? ` por ${updatedBy}` : ""}
    </p>
  );
}

function defaultScoringRules(): ScoringRuleEntry[] {
  return [
    { outcomeType: "EXACT", basePoints: 10, description: null, updatedAt: "", updatedBy: null },
    { outcomeType: "WINNER_AND_DIFF", basePoints: 6, description: null, updatedAt: "", updatedBy: null },
    { outcomeType: "DRAW_DIFFERENT", basePoints: 4, description: null, updatedAt: "", updatedBy: null },
    { outcomeType: "WINNER_ONLY", basePoints: 3, description: null, updatedAt: "", updatedBy: null },
    { outcomeType: "MISS", basePoints: 0, description: null, updatedAt: "", updatedBy: null },
  ];
}

function defaultPhaseMultipliers(): PhaseMultiplierEntry[] {
  return [
    { phase: "GROUPS", multiplier: 1, updatedAt: "", updatedBy: null },
    { phase: "ROUND_32", multiplier: 2, updatedAt: "", updatedBy: null },
    { phase: "ROUND_16", multiplier: 2, updatedAt: "", updatedBy: null },
    { phase: "QUARTERS", multiplier: 3, updatedAt: "", updatedBy: null },
    { phase: "SEMIS", multiplier: 4, updatedAt: "", updatedBy: null },
    { phase: "THIRD_PLACE", multiplier: 4, updatedAt: "", updatedBy: null },
    { phase: "FINAL", multiplier: 5, updatedAt: "", updatedBy: null },
  ];
}

function defaultSpecialRules(): SpecialPrizeRuleEntry[] {
  // Defaults usados sólo cuando el endpoint del backend falla — los
  // valores reales vienen del seed seed-config.ts. Las keys deben
  // matchear schema.prisma: special_prize_rules.key (camelCase).
  return [
    { key: "champion", points: 25, description: null, updatedAt: "", updatedBy: null },
    { key: "runnerUp", points: 12, description: null, updatedAt: "", updatedBy: null },
    { key: "thirdPlace", points: 8, description: null, updatedAt: "", updatedBy: null },
    { key: "topScorer", points: 15, description: null, updatedAt: "", updatedBy: null },
    { key: "totalGoalsExact", points: 10, description: null, updatedAt: "", updatedBy: null },
    { key: "totalGoalsClose", points: 5, description: null, updatedAt: "", updatedBy: null },
  ];
}

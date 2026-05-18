"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { queryKeys } from "@/lib/api/queryKeys";
import { copyToClipboard } from "@/lib/utils/password";
import { cn } from "@/lib/utils/cn";
import {
  seedTeams,
  seedConfig,
  seedMatches,
  seedDemo,
  type SeedTeamsResponse,
  type SeedConfigResponse,
  type SeedMatchesResponse,
  type SeedDemoResponse,
} from "@/lib/api/admin";

/**
 * `/admin/dev/seed` — panel oculto que envuelve los 4 endpoints
 * `POST /admin/dev/seed/{teams,config,matches,demo}`.
 *
 * No tiene entrada en el sidebar; el admin lo accede tipeando la URL
 * cuando necesita seedear environments donde `npx tsx` no es viable
 * (Dokploy terminal etc). Los endpoints son idempotentes pero
 * modifican datos productivos — el header lleva un badge "Dev only"
 * en color warning.
 *
 * Los botones NO se gatean por "paso anterior listo": el backend ya
 * valida (matches devuelve 400 si no hay teams, demo idem). El badge
 * verde aparece cuando el paso corrió OK al menos una vez en la sesión.
 */
export default function AdminDevSeedPage() {
  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Bootstrap
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
              Dev seed panel
            </span>
          </h1>
          <span
            className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-landing-gold)] bg-[var(--color-landing-gold)]/15 px-2 py-1 font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-gold)]"
            role="status"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Dev only
          </span>
        </div>
        <p className="mt-3 font-sans text-sm text-[var(--color-landing-text-muted)]">
          Solo admin. Las acciones son idempotentes pero modifican datos
          productivos — corré los pasos en orden cuando setees un environment
          desde cero.
        </p>
      </header>

      <ol className="space-y-4">
        <TeamsStep />
        <ConfigStep />
        <MatchesStep />
        <DemoStep />
      </ol>
    </div>
  );
}

// ── Steps ──────────────────────────────────────────────────────────

function TeamsStep() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => seedTeams(),
    onSuccess: (data) => {
      toast.success(
        `Step 1 completed — ${data.inserted} insertados, ${data.updated} actualizados`,
      );
      // Las standings públicas dependen de teams; invalidamos por las dudas.
      qc.invalidateQueries({ queryKey: queryKeys.groups.standings() });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos seedear teams");
    },
  });

  return (
    <SeedCard
      stepNumber={1}
      title="Teams"
      description="48 selecciones del Mundial 2026 (idempotente: upsert por fifaCode)."
      done={mutation.isSuccess}
      pending={mutation.isPending}
      onRun={() => mutation.mutate()}
      errorMessage={mutation.isError ? mutation.error?.message : undefined}
      response={
        mutation.data ? <TeamsResponse data={mutation.data} /> : null
      }
      rawJson={mutation.data}
    />
  );
}

function ConfigStep() {
  const mutation = useMutation({
    mutationFn: () => seedConfig(),
    onSuccess: (data) => {
      toast.success(
        `Step 2 completed — ${data.scoringRules} reglas, ${data.phaseMultipliers} multipliers, ${data.specialPrizeRules} premios, ${data.appConfig} configs`,
      );
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos seedear config");
    },
  });

  return (
    <SeedCard
      stepNumber={2}
      title="Config"
      description="Scoring rules, multipliers de fase, premios especiales y app config (precio inscripción, distribución del pozo, etc)."
      done={mutation.isSuccess}
      pending={mutation.isPending}
      onRun={() => mutation.mutate()}
      errorMessage={mutation.isError ? mutation.error?.message : undefined}
      response={
        mutation.data ? <ConfigResponse data={mutation.data} /> : null
      }
      rawJson={mutation.data}
    />
  );
}

function MatchesStep() {
  const mutation = useMutation({
    mutationFn: () => seedMatches(),
    onSuccess: (data) => {
      toast.success(
        `Step 3 completed — ${data.inserted} insertados, ${data.updated} actualizados`,
      );
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos seedear matches");
    },
  });

  return (
    <SeedCard
      stepNumber={3}
      title="Matches"
      description="104 partidos del Mundial con FK de teams resuelta. Requiere Teams seeded."
      done={mutation.isSuccess}
      pending={mutation.isPending}
      onRun={() => mutation.mutate()}
      errorMessage={mutation.isError ? mutation.error?.message : undefined}
      response={
        mutation.data ? <MatchesResponse data={mutation.data} /> : null
      }
      rawJson={mutation.data}
    />
  );
}

function DemoStep() {
  const mutation = useMutation({
    mutationFn: () => seedDemo(),
    onSuccess: (data) => {
      toast.success(
        `Step 4 completed — ${data.users.length} usuarios, ${data.compressedMatches} matches comprimidos`,
      );
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos seedear demo");
    },
  });

  return (
    <SeedCard
      stepNumber={4}
      title="Demo"
      description="4 bots con predicciones aleatorias + 1 personal user. Comprime la timeline (matchNumber 1 → ahora+1h, 104 → ahora+7d). Requiere Matches seeded."
      done={mutation.isSuccess}
      pending={mutation.isPending}
      onRun={() => mutation.mutate()}
      errorMessage={mutation.isError ? mutation.error?.message : undefined}
      response={
        mutation.data ? <DemoResponse data={mutation.data} /> : null
      }
      rawJson={mutation.data}
    >
      {mutation.data ? <DemoCredentials data={mutation.data} /> : null}
    </SeedCard>
  );
}

// ── Card shell ─────────────────────────────────────────────────────

interface SeedCardProps {
  stepNumber: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  done: boolean;
  pending: boolean;
  onRun: () => void;
  errorMessage?: string;
  response: ReactNode;
  rawJson: unknown;
  children?: ReactNode;
}

function SeedCard({
  stepNumber,
  title,
  description,
  done,
  pending,
  onRun,
  errorMessage,
  response,
  rawJson,
  children,
}: SeedCardProps) {
  return (
    <li className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6 list-none">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[var(--color-landing-surface-2)] font-[family-name:var(--font-landing-mono)] text-sm font-bold text-[var(--color-landing-text)]">
            {stepNumber}
          </span>
          <div className="min-w-0">
            <h2 className="font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight text-[var(--color-landing-text)]">
              {title}
            </h2>
            <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
              {description}
            </p>
          </div>
        </div>
        {done ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-[var(--color-landing-green)] px-2 py-1 font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)]"
            aria-label="completado"
          >
            <Check className="h-3 w-3" aria-hidden />
            OK
          </span>
        ) : null}
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant={done ? "outlined" : "primary"}
          onClick={onRun}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Ejecutando
            </>
          ) : done ? (
            "Re-ejecutar"
          ) : (
            "Ejecutar"
          )}
        </Button>
        {response ? (
          <span className="font-sans text-xs text-[var(--color-landing-text-muted)]">
            {response}
          </span>
        ) : null}
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="mt-3 rounded-sm border border-[var(--color-landing-red)] bg-[var(--color-landing-red)]/10 px-3 py-2 font-sans text-xs text-[var(--color-landing-text)]"
        >
          {errorMessage}
        </p>
      ) : null}

      {children}

      {rawJson !== undefined && rawJson !== null ? (
        <details className="mt-4">
          <summary className="cursor-pointer font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]">
            Ver respuesta JSON
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-sm bg-[var(--color-landing-surface-2)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-landing-text)]">
            {JSON.stringify(rawJson, null, 2)}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

// ── Response summaries (one-liners inline next to button) ──────────

function TeamsResponse({ data }: { data: SeedTeamsResponse }) {
  return (
    <>
      count: <b className="font-mono">{data.count}</b> · inserted:{" "}
      <b className="font-mono">{data.inserted}</b> · updated:{" "}
      <b className="font-mono">{data.updated}</b>
    </>
  );
}

function ConfigResponse({ data }: { data: SeedConfigResponse }) {
  return (
    <>
      scoring: <b className="font-mono">{data.scoringRules}</b> · multipliers:{" "}
      <b className="font-mono">{data.phaseMultipliers}</b> · prizes:{" "}
      <b className="font-mono">{data.specialPrizeRules}</b> · config:{" "}
      <b className="font-mono">{data.appConfig}</b>
    </>
  );
}

function MatchesResponse({ data }: { data: SeedMatchesResponse }) {
  return (
    <>
      count: <b className="font-mono">{data.count}</b> · inserted:{" "}
      <b className="font-mono">{data.inserted}</b> · updated:{" "}
      <b className="font-mono">{data.updated}</b>
    </>
  );
}

function DemoResponse({ data }: { data: SeedDemoResponse }) {
  return (
    <>
      users: <b className="font-mono">{data.users.length}</b> · timeline:{" "}
      <b className="font-mono">{data.compressedMatches}</b> matches
    </>
  );
}

// ── Demo credentials card (highlighted) ────────────────────────────

function DemoCredentials({ data }: { data: SeedDemoResponse }) {
  const personal = data.users.find((u) => u.personal);
  const bots = data.users.filter((u) => !u.personal);

  return (
    <div className="mt-4 rounded-sm border border-[var(--color-landing-green)] bg-[var(--color-landing-green)]/10 p-4">
      <p className="font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-green)]">
        Credenciales generadas
      </p>
      <p className="mt-1 font-sans text-xs text-[var(--color-landing-text-muted)]">
        Password para todos: <b className="font-mono text-[var(--color-landing-text)]">demo123!</b>
      </p>

      {personal ? (
        <div className="mt-3">
          <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--color-landing-text-muted)]">
            Personal (vos)
          </p>
          <DniRow dni={personal.dni} label={`${personal.firstName} — DNI`} />
        </div>
      ) : null}

      {bots.length > 0 ? (
        <div className="mt-3">
          <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--color-landing-text-muted)]">
            Bots
          </p>
          <ul className="mt-1 space-y-1">
            {bots.map((bot) => (
              <li key={bot.dni}>
                <DniRow
                  dni={bot.dni}
                  label={`${bot.firstName} — DNI`}
                  suffix={
                    <span className="font-sans text-[11px] text-[var(--color-landing-text-muted)]">
                      {bot.predictions} preds
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DniRow({
  dni,
  label,
  suffix,
}: {
  dni: string;
  label: string;
  suffix?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(dni);
    if (ok) {
      setCopied(true);
      toast.success(`DNI ${dni} copiado`);
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error("No se pudo copiar — copialo manualmente");
    }
  };

  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="font-sans text-xs text-[var(--color-landing-text-muted)]">
        {label}
      </span>
      <code className="font-mono text-sm font-bold text-[var(--color-landing-text)]">
        {dni}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copiar DNI ${dni}`}
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] text-[var(--color-landing-text-muted)] transition-colors hover:border-[var(--color-landing-text)] hover:text-[var(--color-landing-text)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
        )}
      >
        {copied ? (
          <Check className="h-3 w-3" aria-hidden />
        ) : (
          <Copy className="h-3 w-3" aria-hidden />
        )}
      </button>
      {suffix ? <span className="ml-auto">{suffix}</span> : null}
    </div>
  );
}

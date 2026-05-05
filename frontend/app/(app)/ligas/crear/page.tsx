"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Share2, Trophy } from "lucide-react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { createLeague } from "@/lib/api/leagues";
import { queryKeys } from "@/lib/api/queryKeys";
import type { EntrySummary, League } from "@/lib/api/types";
import { useActiveEntry } from "@/lib/hooks/use-active-entry";
import { cn } from "@/lib/utils/cn";

const FRONTEND_URL =
  process.env.NEXT_PUBLIC_FRONTEND_URL ?? "http://localhost:3000";

const schema = z.object({
  name: z
    .string()
    .min(3, "Minimo 3 caracteres")
    .max(50, "Maximo 50 caracteres"),
  description: z
    .string()
    .max(200, "Maximo 200 caracteres")
    .optional()
    .or(z.literal("")),
  isPublic: z.boolean(),
  maxMembers: z
    .number({ message: "Numero invalido" })
    .int()
    .min(2, "Minimo 2")
    .max(200, "Maximo 200"),
});

type FormValues = z.infer<typeof schema>;

const labelClasses =
  "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]";

const inputClasses =
  "h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] focus:border-[var(--color-landing-green)]";

export default function CrearLigaPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { entries, activeEntry } = useActiveEntry();
  const [created, setCreated] = useState<League | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(
    activeEntry?.id ?? null,
  );

  // Mantener selectedEntryId sincronizado con activeEntry inicial
  // sin pisar la elección manual del user.
  if (selectedEntryId === null && activeEntry) {
    setSelectedEntryId(activeEntry.id);
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      description: "",
      isPublic: false,
      maxMembers: 50,
    },
  });

  const createMutation = useMutation({
    mutationFn: (dto: {
      name: string;
      description?: string;
      isPublic?: boolean;
      maxMembers?: number;
      entryId: string;
    }) => createLeague(dto),
    onSuccess: (league) => {
      qc.invalidateQueries({ queryKey: queryKeys.leagues.all() });
      setCreated(league);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos crear la liga.");
    },
  });

  const onSubmit = (values: FormValues) => {
    if (!selectedEntryId) {
      toast.error("Elegí con qué prode querés unirte a la liga.");
      return;
    }
    createMutation.mutate({
      name: values.name,
      description: values.description?.trim()
        ? values.description.trim()
        : undefined,
      isPublic: values.isPublic,
      maxMembers: values.maxMembers,
      entryId: selectedEntryId,
    });
  };

  return (
    <section className="mx-auto max-w-xl px-4 pb-20 pt-10 md:px-8 md:pb-24 md:pt-14">
      <Link
        href="/ligas"
        className="inline-flex items-center gap-2 mb-4 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)]"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Volver
      </Link>

      <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        Mini-liga
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">
        <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
          Crear liga.
        </span>
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
        Compartís un código con tus amigos y se suman.
      </p>

      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mt-10 flex flex-col gap-6"
        noValidate
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="name" className={labelClasses}>
            Nombre
          </label>
          <input
            id="name"
            type="text"
            autoComplete="off"
            placeholder="Los Pibes del Barrio"
            aria-invalid={form.formState.errors.name ? "true" : "false"}
            className={inputClasses}
            {...form.register("name")}
          />
          {form.formState.errors.name ? (
            <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-red)]">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="description" className={labelClasses}>
            Descripción (opcional)
          </label>
          <input
            id="description"
            type="text"
            autoComplete="off"
            placeholder="Mini-liga de la oficina"
            aria-invalid={form.formState.errors.description ? "true" : "false"}
            className={inputClasses}
            {...form.register("description")}
          />
          {form.formState.errors.description ? (
            <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-red)]">
              {form.formState.errors.description.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="maxMembers" className={labelClasses}>
            Cantidad máxima de miembros
          </label>
          <input
            id="maxMembers"
            type="number"
            inputMode="numeric"
            min={2}
            max={200}
            aria-invalid={form.formState.errors.maxMembers ? "true" : "false"}
            className={inputClasses}
            {...form.register("maxMembers", { valueAsNumber: true })}
          />
          {form.formState.errors.maxMembers ? (
            <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-red)]">
              {form.formState.errors.maxMembers.message}
            </p>
          ) : null}
        </div>

        {entries.length > 1 ? (
          <EntryPicker
            entries={entries}
            value={selectedEntryId}
            onChange={setSelectedEntryId}
          />
        ) : null}

        <label className="flex items-start gap-3 cursor-pointer rounded-sm border border-[var(--color-landing-line)] bg-[var(--color-landing-surface)] p-4 transition-colors hover:border-[var(--color-landing-line-strong)]">
          <input
            type="checkbox"
            className={cn(
              "mt-1 h-5 w-5 shrink-0 rounded-sm appearance-none cursor-pointer",
              "border-2 border-[var(--color-landing-line-strong)] bg-transparent",
              "checked:bg-[var(--color-landing-green)] checked:border-[var(--color-landing-green)]",
              "checked:bg-[length:14px_14px] checked:bg-no-repeat checked:bg-center",
              "checked:[background-image:url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23f1ece0%22%20stroke-width=%223%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22><polyline%20points=%2220%206%209%2017%204%2012%22/></svg>')]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
            )}
            {...form.register("isPublic")}
          />
          <div className="min-w-0">
            <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text)]">
              Liga pública
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-landing-text-muted)]">
              Cualquiera con el código puede unirse. Las privadas requieren aprobación del owner (próximamente).
            </p>
          </div>
        </label>

        <button
          type="submit"
          disabled={createMutation.isPending}
          className="inline-flex w-full items-center justify-center rounded-sm bg-[var(--color-landing-red)] px-6 py-4 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {createMutation.isPending ? "Creando..." : "Crear liga"}
        </button>
      </form>

      <CreatedDialog
        league={created}
        onClose={() => setCreated(null)}
        onGoToLeaderboard={() => {
          if (created) router.push(`/leaderboard/liga/${created.id}`);
          setCreated(null);
        }}
      />
    </section>
  );
}

/**
 * EntryPicker (multi-prode v1.1, spec §4.5). Cuando el user tiene >1
 * entry, le pedimos cuál unir a la liga. Default: activeEntry. Lista
 * de radios estilo dark editorial — un fieldset por entry con alias
 * o "Mi prode #N" + stats inline.
 */
function EntryPicker({
  entries,
  value,
  onChange,
}: {
  entries: EntrySummary[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)] mb-1">
        ¿Con cuál de tus prodes?
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map((e) => {
          const checked = value === e.id;
          const label = e.alias?.trim() ? e.alias : `Mi prode #${e.position}`;
          return (
            <label
              key={e.id}
              className={cn(
                "flex items-center gap-3 cursor-pointer rounded-sm border p-3 transition-colors",
                checked
                  ? "border-[var(--color-landing-green)] bg-[var(--color-landing-surface-2)]"
                  : "border-[var(--color-landing-line)] bg-[var(--color-landing-surface)] hover:border-[var(--color-landing-line-strong)]",
              )}
            >
              <input
                type="radio"
                name="entry-picker"
                value={e.id}
                checked={checked}
                onChange={() => onChange(e.id)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 rounded-full border-2 transition-colors",
                  checked
                    ? "border-[var(--color-landing-green)] bg-[var(--color-landing-green)]"
                    : "border-[var(--color-landing-line-strong)]",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text)] truncate">
                  {label}
                </span>
                <span className="block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)] tabular-nums mt-1">
                  {e.stats.totalPoints} pts
                  {e.stats.rank !== null ? ` · pos ${e.stats.rank}` : ""}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function CreatedDialog({
  league,
  onClose,
  onGoToLeaderboard,
}: {
  league: League | null;
  onClose: () => void;
  onGoToLeaderboard: () => void;
}) {
  const open = league !== null;
  const code = league?.inviteCode ?? "";

  const waText = league
    ? `Te invito a mi mini-liga del Prode con codigo ${code}: ${FRONTEND_URL}/ligas/unirme?code=${code}`
    : "";
  const waHref = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-landing-display)] text-3xl uppercase tracking-tight text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[4px] border-[var(--color-landing-green)] pb-1">
              Liga creada
            </span>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            Pasale este código a tus amigos para que se unan.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] py-6 text-center">
          <p className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
            Código de invitación
          </p>
          <p
            className="mt-3 font-[family-name:var(--font-landing-display)] uppercase tracking-tight tabular-nums leading-none text-[var(--color-landing-gold)]"
            style={{ fontSize: "clamp(48px, 14vw, 80px)" }}
          >
            {code}
          </p>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-stretch">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-sm bg-[var(--color-landing-red)] px-6 h-12 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
          >
            <Share2 className="h-4 w-4" aria-hidden />
            Compartir por WhatsApp
          </a>
          <button
            type="button"
            onClick={onGoToLeaderboard}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 h-12 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
          >
            <Trophy className="h-4 w-4" aria-hidden />
            Ver tabla
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

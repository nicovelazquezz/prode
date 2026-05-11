"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Pencil, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { updateEntryAlias } from "@/lib/api/entries";
import { queryKeys } from "@/lib/api/queryKeys";
import { useActiveEntry } from "@/lib/hooks/use-active-entry";
import type { EntrySummary } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

const MAX_ALIAS_LENGTH = 40;

const ENTRY_PRICE_LABEL = "$10.000";

const triggerBase =
  "inline-flex items-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-3 h-9 transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

const triggerInteractive = "hover:border-[var(--color-landing-text)]";

const eyebrowMono =
  "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]";

const labelMono =
  "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text)]";

/**
 * EntrySwitcher (spec §5.2). Selector del entry activo del user en el
 * `<AppHeader>`. Estados:
 *
 *  - **Loading** (auth bootstrap o /entries/me): skeleton de 9px alto.
 *  - **0 entries** (user nuevo sin pago confirmado, edge case raro
 *    porque /predicciones lo asume): no renderiza nada.
 *  - **1 entry**: display read-only del alias / "Mi prode" sin dropdown.
 *    El CTA "+ Crear otro" aparece en el dropdown que se abre al click
 *    del botón principal (botón siempre interactivo, abre el menú con
 *    sólo el item "Crear otro" si hay 1 entry — ver spec §8 caso edge).
 *  - **2+ entries**: dropdown con la lista + CTA "+ Crear otro".
 *
 * Tema: dark editorial — paleta `--color-landing-*`, eyebrow mono
 * uppercase tracking, primary CTA verde para acciones positivas,
 * separator entre lista de entries y CTA de crear nuevo.
 *
 * `onCreateNew`: callback para abrir el `<NewEntryModal>`. Lo eleva
 * el caller para no acoplar este componente al modal.
 */
export interface EntrySwitcherProps {
  onCreateNew: () => void;
  className?: string;
}

export function EntrySwitcher({ onCreateNew, className }: EntrySwitcherProps) {
  const { entries, activeEntry, setActiveEntry, isLoading, canCreateMore } =
    useActiveEntry();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Renombrar abre un Dialog separado del DropdownMenu — Radix
  // intercepta keyboard events dentro del menú, así que un input
  // inline complica la UX. El dialog también es más visible para
  // confirmar que el cambio se guardó.
  const [renamingEntry, setRenamingEntry] = useState<EntrySummary | null>(
    null,
  );

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        className={cn(
          "h-9 w-40 rounded-sm bg-[var(--color-landing-surface)] border border-[var(--color-landing-line)] animate-pulse",
          className,
        )}
      />
    );
  }

  if (!entries.length) {
    return null;
  }

  const displayName = (e: EntrySummary | null) =>
    e?.alias && e.alias.trim().length > 0
      ? e.alias
      : e
        ? `Mi prode${entries.length > 1 ? ` #${e.position}` : ""}`
        : "Mi prode";

  const handleSelect = (entryId: string) => {
    setActiveEntry(entryId);
    setOpen(false);
    // Si la URL tenía ?entry=, removerlo: el localStorage es ahora la fuente.
    if (pathname && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("entry")) {
        url.searchParams.delete("entry");
        router.replace(`${pathname}${url.search}`);
      }
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Cambiar de prode"
          className={cn(triggerBase, triggerInteractive, "max-w-[220px]", className)}
        >
          <span className={cn("min-w-0 truncate", labelMono)}>
            {displayName(activeEntry)}
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-[var(--color-landing-text-muted)]"
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-[260px]">
        <DropdownMenuLabel className={cn(eyebrowMono, "px-2 py-2")}>
          Mis prodes
        </DropdownMenuLabel>

        {entries.map((entry) => {
          const isActive = entry.id === activeEntry?.id;
          const stats = entry.stats;
          // El alias se puede renombrar hasta el kickoff inaugural; el
          // backend valida la ventana. Como proxy en UI, el flag
          // `specialPredictionLocked` nos dice cuándo se cerró todo
          // lo "pre-torneo" — incluye el alias. Si está locked, no
          // mostramos el botón de Pencil.
          const renameLocked = stats.specialPredictionLocked;
          return (
            <DropdownMenuItem
              key={entry.id}
              onSelect={() => handleSelect(entry.id)}
              className={cn(
                "flex items-start gap-2 px-2 py-2 cursor-pointer group",
                isActive && "bg-[var(--color-landing-surface-2)]",
              )}
            >
              <Check
                className={cn(
                  "mt-1 h-3.5 w-3.5 shrink-0 text-[var(--color-landing-green)]",
                  isActive ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className={cn(labelMono, "truncate")}>
                  {displayName(entry)}
                </p>
                <p className="mt-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)] tabular-nums">
                  {stats.totalPoints} pts
                  {stats.rank !== null ? ` · pos ${stats.rank}` : ""}
                </p>
              </div>
              {!renameLocked ? (
                <button
                  type="button"
                  onClick={(e) => {
                    // Stop propagation impide que el click sobre el
                    // ícono dispare el handleSelect del item padre.
                    e.stopPropagation();
                    setOpen(false);
                    setRenamingEntry(entry);
                  }}
                  aria-label={`Renombrar ${displayName(entry)}`}
                  className={cn(
                    "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm",
                    "text-[var(--color-landing-text-muted)] transition-colors",
                    "hover:text-[var(--color-landing-gold)] hover:bg-[var(--color-landing-bg)]",
                    "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-landing-gold)]",
                  )}
                >
                  <Pencil className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!canCreateMore}
          onSelect={() => {
            if (!canCreateMore) return;
            setOpen(false);
            onCreateNew();
          }}
          className={cn(
            "flex items-center gap-2 px-2 py-2 cursor-pointer",
            !canCreateMore && "opacity-50 cursor-not-allowed",
          )}
          aria-label={
            canCreateMore
              ? `Crear otro prode por ${ENTRY_PRICE_LABEL}`
              : "Llegaste al máximo de prodes"
          }
        >
          <Plus
            className="h-3.5 w-3.5 shrink-0 text-[var(--color-landing-green)]"
            aria-hidden
          />
          <span className={cn(labelMono, "flex-1 truncate")}>
            Crear otro prode
          </span>
          <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-gold)] tabular-nums">
            {ENTRY_PRICE_LABEL}
          </span>
        </DropdownMenuItem>

        {!canCreateMore ? (
          <p className="px-2 pt-1 pb-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
            Llegaste al máximo configurado
          </p>
        ) : null}
      </DropdownMenuContent>

      <RenameEntryDialog
        entry={renamingEntry}
        onClose={() => setRenamingEntry(null)}
      />
    </DropdownMenu>
  );
}

/**
 * Dialog para renombrar un entry. Pre-llena con el alias actual; si
 * el user lo deja vacío, el backend interpreta como "limpiar alias"
 * y volvemos al fallback "Mi prode #N". Validación: max 40 chars,
 * trim al guardar. Bloqueado por backend después del kickoff (devuelve
 * 4xx; mostramos toast).
 */
function RenameEntryDialog({
  entry,
  onClose,
}: {
  entry: EntrySummary | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");

  // Sync cuando se abre/cambia entry — pre-llenamos con el alias.
  useEffect(() => {
    setValue(entry?.alias ?? "");
  }, [entry]);

  const mutation = useMutation({
    mutationFn: async (next: string | null) => {
      if (!entry) throw new Error("No entry selected");
      return updateEntryAlias(entry.id, next);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.entries.me() });
      toast.success("Prode renombrado");
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos guardar el nuevo nombre");
    },
  });

  const trimmed = value.trim();
  const tooLong = trimmed.length > MAX_ALIAS_LENGTH;
  const isUnchanged = trimmed === (entry?.alias?.trim() ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tooLong || mutation.isPending) return;
    // Vacío = null para que el backend lo interprete como "sin alias".
    mutation.mutate(trimmed.length === 0 ? null : trimmed);
  };

  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          <span className="inline-block border-b-[3px] border-[var(--color-landing-green)] pb-1">
            Renombrar prode
          </span>
        </DialogTitle>
        <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
          Ponele un nombre para distinguirlo del resto. Dejalo vacío para
          volver al nombre por defecto.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={MAX_ALIAS_LENGTH + 10}
            autoFocus
            placeholder={`Mi prode #${entry?.position ?? 1}`}
            aria-label="Nuevo nombre del prode"
            className="h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
          />
          <div className="flex items-center justify-between font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em]">
            <span
              className={
                tooLong
                  ? "text-[var(--color-landing-red)]"
                  : "text-[var(--color-landing-text-muted)]"
              }
            >
              {trimmed.length} / {MAX_ALIAS_LENGTH}
            </span>
            {tooLong ? (
              <span className="text-[var(--color-landing-red)]">
                Máximo {MAX_ALIAS_LENGTH} caracteres
              </span>
            ) : null}
          </div>
          <DialogFooter className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-stretch">
            <button
              type="button"
              onClick={onClose}
              disabled={mutation.isPending}
              className="inline-flex flex-1 items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={tooLong || isUnchanged || mutation.isPending}
              className="inline-flex flex-1 items-center justify-center rounded-sm bg-[var(--color-landing-red)] px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mutation.isPending ? "Guardando..." : "Guardar"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

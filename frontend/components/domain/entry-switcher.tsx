"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Check, ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useActiveEntry } from "@/lib/hooks/use-active-entry";
import type { EntrySummary } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

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
          return (
            <DropdownMenuItem
              key={entry.id}
              onSelect={() => handleSelect(entry.id)}
              className={cn(
                "flex items-start gap-2 px-2 py-2 cursor-pointer",
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
    </DropdownMenu>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { HTTPError } from "ky";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { initEntryPayment } from "@/lib/api/entries";
import { cn } from "@/lib/utils/cn";

const ENTRY_PRICE_LABEL = "$10.000";
const ALIAS_MAX = 60;

const labelMono =
  "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]";

const inputClasses =
  "h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] focus:border-[var(--color-landing-green)]";

const buttonPrimary =
  "inline-flex items-center justify-center rounded-sm bg-[var(--color-landing-red)] px-6 py-4 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] disabled:cursor-not-allowed disabled:opacity-40";

const buttonGhost =
  "inline-flex items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 py-4 font-[family-name:var(--font-landing-mono)] text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] disabled:cursor-not-allowed disabled:opacity-40";

const errorText =
  "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-red)]";

interface CapErrorBody {
  code?: string;
  current?: number;
  cap?: number;
  message?: string;
}

export interface NewEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * NewEntryModal (spec §5.3). Form simple para arrancar el flujo de
 * pago de un prode adicional cuando el user ya está logueado.
 *
 *  - Input alias opcional (max 60 chars, validación local + backend)
 *  - Resumen de costo ($10.000, hardcoded matching la landing —
 *    el backend valida el monto canonical desde AppConfig)
 *  - Submit dispara `POST /entries/init-payment` con `{ alias }`,
 *    devuelve `initPoint` (URL MP), redirige.
 *  - 409 ENTRY_CAP_REACHED: cierra el modal + toast.
 *  - Otros errores: mantiene el modal con mensaje inline.
 *
 * Tema dark editorial: bg surface, eyebrow mono uppercase, primary
 * CTA red para "PAGAR", ghost para "Cancelar".
 *
 * Para tests E2E del flow MercadoPago mock, ver
 * tests/e2e/06-multi-prode.spec.ts.
 */
export function NewEntryModal({ open, onOpenChange }: NewEntryModalProps) {
  const [alias, setAlias] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset state cuando se cierra el modal.
  useEffect(() => {
    if (!open) {
      setAlias("");
      setSubmitError(null);
    }
  }, [open]);

  const initMutation = useMutation({
    mutationFn: (aliasArg: string | null) =>
      initEntryPayment({ alias: aliasArg }),
    onSuccess: ({ initPoint }) => {
      // El user va a MP / mock-checkout. El return URL trae
      // `?paymentId=...&logged=1` y la página de success polling
      // /entries/me hasta ver el nuevo entry, después redirect a
      // /predicciones?entry=<newId>.
      if (typeof window !== "undefined") {
        window.location.assign(initPoint);
      }
    },
    onError: (err: Error) => {
      let message = "No pudimos iniciar el pago. Probá de nuevo.";
      if (err instanceof HTTPError) {
        // ky v2: el body ya fue parseado en `err.data` antes de
        // disparar el throw. El método tradicional `response.json()`
        // falla porque el cuerpo fue consumido.
        const body =
          (err as HTTPError<CapErrorBody>).data &&
          typeof err.data === "object"
            ? (err.data as CapErrorBody)
            : null;
        if (body?.code === "ENTRY_CAP_REACHED") {
          const cap = body.cap ?? 5;
          message = `Llegaste al máximo de ${cap} entradas.`;
          toast.error(message);
          onOpenChange(false);
          return;
        }
        if (body?.message) message = body.message;
      }
      setSubmitError(message);
      toast.error(message);
    },
  });

  const trimmed = alias.trim();
  const aliasValid = trimmed.length <= ALIAS_MAX;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aliasValid || initMutation.isPending) return;
    setSubmitError(null);
    initMutation.mutate(trimmed.length === 0 ? null : trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-landing-display)] text-3xl uppercase tracking-tight text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[4px] border-[var(--color-landing-green)] pb-1">
              Nuevo prode
            </span>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            Cargá un alias opcional y procedé al pago. Tu entrada queda
            disponible apenas se aprueba el pago.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="mt-2 flex flex-col gap-5"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="entry-alias" className={labelMono}>
              Alias (opcional)
            </label>
            <input
              id="entry-alias"
              type="text"
              autoComplete="off"
              maxLength={ALIAS_MAX}
              placeholder="Ej. Mi prode optimista"
              value={alias}
              onChange={(e) => {
                setAlias(e.target.value);
                setSubmitError(null);
              }}
              disabled={initMutation.isPending}
              aria-invalid={!aliasValid}
              className={inputClasses}
            />
            <p className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
              {trimmed.length} / {ALIAS_MAX}
            </p>
          </div>

          <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] p-4 flex items-center justify-between">
            <span className={labelMono}>Costo</span>
            <span className="font-[family-name:var(--font-landing-display)] text-3xl tabular-nums leading-none text-[var(--color-landing-gold)]">
              {ENTRY_PRICE_LABEL}
            </span>
          </div>

          {submitError ? (
            <p role="alert" className={errorText}>
              {submitError}
            </p>
          ) : null}

          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-stretch">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={initMutation.isPending}
              className={cn(buttonGhost, "flex-1")}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!aliasValid || initMutation.isPending}
              className={cn(buttonPrimary, "flex-1")}
            >
              {initMutation.isPending
                ? "Redirigiendo…"
                : "Pagar con MercadoPago"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

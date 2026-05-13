"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/hooks/use-auth";
import { cn } from "@/lib/utils/cn";

const ADMIN_WHATSAPP = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? "";

const buttonPrimary =
  "inline-flex items-center justify-center rounded-sm bg-[var(--color-landing-green)] px-6 py-4 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] disabled:cursor-not-allowed disabled:opacity-40";

const buttonGhost =
  "inline-flex items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 py-4 font-[family-name:var(--font-landing-mono)] text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

export interface NewEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * NewEntryModal — request-by-WhatsApp flow.
 *
 * Decisión de producto (mayo 2026): los prodes adicionales NO se pagan
 * por MercadoPago. El user pide otro prode al admin por WhatsApp, el
 * admin coordina el pago offline (efectivo/transferencia) y registra
 * el Entry manualmente desde `/admin/pagos` (endpoint
 * `POST /admin/payments/manual`).
 *
 * El modal acá solo arma el `wa.me` link con un mensaje pre-llenado
 * que incluye el nombre y DNI del solicitante para que el admin sepa
 * a quién sumarle el prode sin tener que preguntar.
 *
 * Si por alguna razón `NEXT_PUBLIC_ADMIN_WHATSAPP` no viene en el
 * bundle, el CTA queda deshabilitado con un mensaje claro (mejor que
 * mandar a wa.me sin número y obtener una página rota).
 */
export function NewEntryModal({ open, onOpenChange }: NewEntryModalProps) {
  const { user } = useAuth();

  const userName = user ? `${user.firstName} ${user.lastName}`.trim() : "";
  const userDni = user?.dni ?? "";

  // Mensaje pre-armado. Incluye DNI + nombre para que el admin pueda
  // identificar al solicitante en /admin/usuarios sin tener que pedirlo.
  const messageLines = [
    "Hola! Quiero sumar otro prode a mi cuenta.",
    "",
    `Nombre: ${userName || "(falta cargar)"}`,
    `DNI: ${userDni || "(falta cargar)"}`,
    "",
    "Coordinemos el pago. ¡Gracias!",
  ];
  const messageText = messageLines.join("\n");

  const canSend = ADMIN_WHATSAPP.length > 0;
  const waLink = canSend
    ? `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(messageText)}`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-landing-display)] text-3xl uppercase tracking-tight text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[4px] border-[var(--color-landing-green)] pb-1">
              Sumar otro prode
            </span>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            Escribinos por WhatsApp y coordinamos el pago. Apenas confirmemos,
            te sumamos el prode a tu cuenta y lo vas a ver al refrescar.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] p-4">
          <p className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
            El mensaje incluye:
          </p>
          <ul className="mt-2 space-y-1 font-sans text-sm text-[var(--color-landing-text)]">
            <li>• Tu nombre: <strong>{userName || "—"}</strong></li>
            <li>• Tu DNI: <strong>{userDni || "—"}</strong></li>
          </ul>
        </div>

        {!canSend ? (
          <p
            role="alert"
            className="mt-3 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-red)]"
          >
            WhatsApp del admin no configurado. Contactalo por otra vía.
          </p>
        ) : null}

        <DialogFooter className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-stretch">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(buttonGhost, "flex-1")}
          >
            Cancelar
          </button>
          {canSend ? (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onOpenChange(false)}
              className={cn(buttonPrimary, "flex-1")}
            >
              Solicitar por WhatsApp
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={cn(buttonPrimary, "flex-1")}
            >
              Solicitar por WhatsApp
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { initPayment } from "@/lib/api/payments";
import { cn } from "@/lib/utils/cn";

const PRECIO = Number(process.env.NEXT_PUBLIC_INSCRIPCION_PRECIO ?? 15000);
const ADMIN_WHATSAPP = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? "";

function formatARS(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildWhatsAppLink(): string {
  const text = encodeURIComponent(
    "Hola! Quiero anotarme al Prode Mundial 2026 del Tiro Federal.",
  );
  // Si no hay numero configurado, abre wa.me sin destino — el user
  // elige contacto. No es el flow ideal pero degrada bien.
  const num = ADMIN_WHATSAPP.replace(/\D/g, "");
  return num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`;
}

/**
 * Seccion CTA de la landing — precio + dos botones.
 *
 *   - "Pagar con MercadoPago": llama POST /payments/init y redirige
 *     al `initPoint` que devuelve el backend (en dev = mock checkout).
 *   - "Escribinos por WhatsApp": link `wa.me/<NUMERO>?text=...` con
 *     mensaje pre-armado. Se abre en nueva pestaña.
 *
 * El email del comprador se completa en el checkout (MP o mock).
 * Aca solo iniciamos el flujo.
 */
export function LandingCta() {
  const [submitting, setSubmitting] = useState(false);

  const mutation = useMutation({
    // El backend resuelve el monto desde AppConfig — `PRECIO` solo se
    // usa para el display arriba. Mandar `amount` haria que la
    // validacion `forbidNonWhitelisted` del DTO rechace el request.
    mutationFn: () => initPayment(),
    onSuccess: (data) => {
      // Reemplazar el current entry para que back no vuelva al landing
      // mientras el backend crea el preference con MP. Si el user vuelve,
      // queremos que cree un nuevo payment.
      window.location.assign(data.initPoint);
    },
    onError: (err) => {
      setSubmitting(false);
      const msg =
        err instanceof Error ? err.message : "Error iniciando el pago";
      toast.error(msg);
    },
  });

  const onPayClick = () => {
    if (submitting) return;
    setSubmitting(true);
    mutation.mutate();
  };

  return (
    <section
      className="bg-white py-12 md:py-20"
      aria-labelledby="cta-heading"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-6 px-4 md:px-8">
        <h2
          id="cta-heading"
          className="font-display text-3xl md:text-5xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]"
        >
          Sumate al Prode
        </h2>

        <div className="flex flex-col">
          <span className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Inscripcion unica
          </span>
          <span
            className={cn(
              "font-display font-black leading-none",
              "text-5xl md:text-7xl",
              "text-[var(--color-prode-accent)]",
            )}
          >
            {formatARS(PRECIO)}
          </span>
        </div>

        <p className="max-w-md font-sans text-sm md:text-base text-[var(--color-prode-text-secondary)]">
          Un solo pago, te queda acceso a los 104 partidos, las
          predicciones especiales y las mini-ligas con tus amigos.
        </p>

        <div className="mt-2 flex w-full flex-col gap-3 sm:max-w-md">
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={onPayClick}
            disabled={submitting || mutation.isPending}
            aria-busy={submitting || mutation.isPending}
            className="w-full"
          >
            {submitting || mutation.isPending
              ? "Iniciando pago..."
              : "Pagar con MercadoPago"}
          </Button>
          <a
            href={buildWhatsAppLink()}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center justify-center w-full",
              "h-14 px-10 text-base",
              "bg-white text-[var(--color-prode-near-black)]",
              "border-2 border-[var(--color-prode-border)] rounded-2xl",
              "font-sans font-medium",
              "transition-colors duration-300 ease-out",
              "hover:border-[var(--color-prode-near-black)]",
              "focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-offset-2",
            )}
          >
            Escribinos por WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

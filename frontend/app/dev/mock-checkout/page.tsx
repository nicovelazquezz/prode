"use client";

import { Suspense, useEffect, useState } from "react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { simulateWebhook } from "@/lib/api/payments";
import type { SimulateWebhookStatus } from "@/lib/api/payments";
import { cn } from "@/lib/utils/cn";

const PRECIO = Number(process.env.NEXT_PUBLIC_INSCRIPCION_PRECIO ?? 15000);
const STORAGE_KEY = "prode.mock.payerEmail";

function formatARS(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Pagina /dev/mock-checkout — solo activa cuando
 * NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT === "true".
 *
 * En produccion la condicion es estatica (Next inlinea
 * NEXT_PUBLIC_*) y `notFound()` da 404 sin renderizar.
 *
 * Lee `?paymentId=xxx&token=plainToken`. Tres botones invocan
 * `simulateWebhook` y redirigen a las paginas de inscripcion
 * correspondientes. El email del comprador persiste en localStorage
 * para que dev no lo retipee entre tests.
 */
export default function MockCheckoutPage() {
  if (process.env.NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT !== "true") {
    notFound();
  }
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-16">
          <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
            Cargando...
          </p>
        </div>
      }
    >
      <MockCheckoutContent />
    </Suspense>
  );
}

function MockCheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentId = searchParams.get("paymentId") ?? "";
  const token = searchParams.get("token") ?? "";

  const [payerEmail, setPayerEmail] = useState("");

  // Hidratar email desde localStorage en mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setPayerEmail(saved);
  }, []);

  const persistEmail = (value: string) => {
    setPayerEmail(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, value);
    }
  };

  const mutation = useMutation({
    mutationFn: (status: SimulateWebhookStatus) =>
      simulateWebhook({
        paymentId,
        status,
        payerEmail: payerEmail || undefined,
      }),
    onSuccess: (data, status) => {
      if (status === "approved") {
        // Usamos el `completionToken` de la respuesta — el backend
        // mintea uno nuevo en cada simulate-webhook (el original solo
        // existia en hash). El `token` que vino en la URL ya esta
        // invalidado a nivel BD.
        router.replace(
          `/inscripcion/success?token=${encodeURIComponent(data.completionToken)}`,
        );
      } else if (status === "rejected") {
        router.replace("/inscripcion/failure");
      } else if (status === "pending") {
        router.replace("/inscripcion/pending");
      }
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : "Error simulando el webhook. Revisa el backend.";
      toast.error(msg);
    },
  });

  const handle = (status: SimulateWebhookStatus) => {
    if (!paymentId) {
      toast.error("Falta el paymentId en la URL");
      return;
    }
    mutation.mutate(status);
  };

  if (!paymentId || !token) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-16">
        <h1 className="font-display text-3xl font-black uppercase tracking-tight text-[var(--color-prode-accent)]">
          Parametros faltantes
        </h1>
        <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
          Esta pagina espera los query params <code>?paymentId=...</code>{" "}
          y <code>&token=...</code> que normalmente envia el backend al
          redirigir desde POST /payments/init en modo dev.
        </p>
      </div>
    );
  }

  const submitting = mutation.isPending;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 md:py-16">
      {/* Banner amarillo de modo desarrollo */}
      <div
        role="status"
        className={cn(
          "rounded-md border-2 border-yellow-400 bg-yellow-50",
          "px-4 py-3 font-sans text-sm font-medium text-yellow-900",
        )}
      >
        <span className="font-display text-base font-black uppercase tracking-wide block">
          Modo desarrollo
        </span>
        <span>
          Este es un checkout simulado. No procesa pagos reales — usa los
          botones de abajo para disparar el webhook al backend.
        </span>
      </div>

      <h1 className="font-display text-4xl md:text-5xl font-black uppercase tracking-tight text-[var(--color-prode-near-black)]">
        Mock checkout
      </h1>

      <dl className="grid grid-cols-3 gap-4 rounded-md border border-[var(--color-prode-border)] bg-white p-4 md:p-6">
        <div className="col-span-3 md:col-span-1">
          <dt className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Monto
          </dt>
          <dd className="font-display text-3xl font-black tabular-nums text-[var(--color-prode-near-black)]">
            {formatARS(PRECIO)}
          </dd>
        </div>
        <div className="col-span-3 md:col-span-2">
          <dt className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Payment ID
          </dt>
          <dd className="font-mono text-xs break-all text-[var(--color-prode-near-black)]">
            {paymentId}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        <Label htmlFor="mock-email">Email del comprador (opcional)</Label>
        <Input
          id="mock-email"
          type="email"
          value={payerEmail}
          onChange={(e) => persistEmail(e.target.value)}
          placeholder="comprador@example.com"
          autoComplete="email"
        />
        <p className="font-sans text-xs text-[var(--color-prode-text-secondary)]">
          Persistido en localStorage para que no lo tipees entre tests.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          className={cn(
            "w-full bg-green-600 text-white hover:bg-green-700",
            "h-14 px-10 text-base",
          )}
          variant="primary"
          size="lg"
          onClick={() => handle("approved")}
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting && mutation.variables === "approved"
            ? "Aprobando..."
            : "Aprobar pago"}
        </Button>
        <Button
          type="button"
          variant="accent"
          size="lg"
          className="w-full"
          onClick={() => handle("rejected")}
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting && mutation.variables === "rejected"
            ? "Rechazando..."
            : "Rechazar pago"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className={cn(
            "w-full bg-[var(--color-prode-surface)]",
            "border border-[var(--color-prode-border)]",
          )}
          onClick={() => handle("pending")}
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting && mutation.variables === "pending"
            ? "Procesando..."
            : "Dejar pendiente"}
        </Button>
      </div>
    </div>
  );
}

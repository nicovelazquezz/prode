"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { initPayment } from "@/lib/api/payments";

type State =
  | { status: "starting" }
  | { status: "redirecting"; initPoint: string }
  | { status: "error"; message: string };

/**
 * Dispatcher de pago — entry point del CTA "Inscribirme · $10.000" del
 * landing. On mount llama POST /payments/init y redirige al initPoint
 * que devuelve MP (en dev, redirige a /dev/mock-checkout).
 *
 * En el redirect duro usamos `window.location.href` porque el initPoint
 * apunta a un dominio externo (mercadopago.com.ar) y router.push no aplica.
 *
 * Errores cubiertos:
 *  - rate limit (429): mensaje + retry
 *  - backend down (network error): mensaje + retry
 *  - cualquier otro 4xx/5xx: mensaje generico + retry + link a WhatsApp
 */
export default function InscripcionPage() {
  const [state, setState] = useState<State>({ status: "starting" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "starting" });

    initPayment()
      .then((res) => {
        if (cancelled) return;
        setState({ status: "redirecting", initPoint: res.initPoint });
        window.location.href = res.initPoint;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : "No pudimos iniciar el pago. Intentá de nuevo.";
        setState({ status: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [retry]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-8 py-16">
      <div className="w-full max-w-md text-center">
        {state.status === "starting" || state.status === "redirecting" ? (
          <>
            <Spinner />
            <h1 className="mt-8 font-[family-name:var(--font-landing-display)] text-3xl uppercase tracking-tight">
              Te llevamos a MercadoPago
            </h1>
            <p className="mt-3 font-[family-name:var(--font-landing-mono)] text-xs uppercase tracking-[0.12em] text-[var(--color-landing-text-muted)]">
              {state.status === "starting"
                ? "Generando link de pago…"
                : "Redirigiendo…"}
            </p>
          </>
        ) : (
          <>
            <h1 className="font-[family-name:var(--font-landing-display)] text-3xl uppercase tracking-tight text-[var(--color-landing-red)]">
              Algo salió mal
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
              {state.message}
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => setRetry((n) => n + 1)}
                className="rounded-sm bg-[var(--color-landing-red)] px-8 py-3 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)]"
              >
                Reintentar
              </button>
              <a
                href="https://wa.me/5492914231087?text=hola%20quiero%20inscribirme%20al%20prode"
                target="_blank"
                rel="noopener noreferrer"
                className="font-[family-name:var(--font-landing-mono)] text-xs uppercase tracking-[0.12em] text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)]"
              >
                Inscribirme por WhatsApp
              </a>
              <Link
                href="/"
                className="font-[family-name:var(--font-landing-mono)] text-xs uppercase tracking-[0.12em] text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)]"
              >
                Volver al inicio
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-landing-line-strong)] border-t-[var(--color-landing-red)]"
    />
  );
}

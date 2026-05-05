"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Página /inscripcion/success?token=xxx — la URL a la que el backend
 * redirige después de un pago aprobado (real o mock).
 *
 * Auto-redirect a /completar-registro?token=xxx después de 1.5s con
 * un mensaje breve. Si por algún motivo no hay token, mostramos un
 * fallback con CTA "Ir al inicio".
 */
export default function InscripcionSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-16">
          <p className="font-[family-name:var(--font-landing-mono)] text-xs uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
            Cargando…
          </p>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  useEffect(() => {
    if (!token) return;
    const t = window.setTimeout(() => {
      router.replace(`/completar-registro?token=${encodeURIComponent(token)}`);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [token, router]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-16 md:py-24">
      <span
        aria-hidden="true"
        className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-landing-green)] font-[family-name:var(--font-landing-display)] text-3xl text-[var(--color-landing-text)]"
      >
        ✓
      </span>
      <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-green)]">
        Pago confirmado
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-4xl uppercase leading-[0.85] tracking-tight md:text-6xl">
        <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
          Listo.
        </span>
      </h1>
      <p className="text-base leading-relaxed text-[var(--color-landing-text-muted)] md:text-lg">
        {token
          ? "Te llevamos a completar tu registro…"
          : "No encontramos el token de continuación. Revisá tu WhatsApp o escribí al admin."}
      </p>
      {!token && (
        <Link
          href="/"
          className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--color-landing-text-muted)] underline-offset-4 transition-colors hover:text-[var(--color-landing-text)] hover:underline"
        >
          ← Volver al inicio
        </Link>
      )}
    </div>
  );
}

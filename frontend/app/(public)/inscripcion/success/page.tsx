"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Pagina /inscripcion/success?token=xxx — la URL a la que el backend
 * redirige despues de un pago aprobado (real o mock).
 *
 * Auto-redirect a /completar-registro?token=xxx despues de 1.5s con
 * un mensaje breve. Si por algun motivo no hay token, mostramos un
 * fallback con CTA "Ir al inicio".
 */
export default function InscripcionSuccessPage() {
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-16 md:py-24">
      <span
        aria-hidden="true"
        className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-prode-accent)] text-white text-3xl font-display font-black"
      >
        ✓
      </span>
      <h1 className="font-display text-4xl md:text-6xl font-black uppercase tracking-tight text-[var(--color-prode-near-black)]">
        Pago confirmado
      </h1>
      <p className="font-sans text-base md:text-lg text-[var(--color-prode-text-secondary)]">
        {token
          ? "Te llevamos a completar tu registro..."
          : "No encontramos el token de continuacion. Revisa tu WhatsApp o escribi al admin."}
      </p>
      {!token && (
        <Link
          href="/"
          className="font-sans text-sm text-[var(--color-prode-near-black)] underline-offset-4 hover:underline"
        >
          Volver al inicio
        </Link>
      )}
    </div>
  );
}

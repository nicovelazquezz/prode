"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { forgotPassword } from "@/lib/api/auth";

const schema = z.object({
  dni: z
    .string()
    .min(7)
    .max(8)
    .regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 números"),
});

type FormValues = z.infer<typeof schema>;

const inputClass =
  "w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-4 py-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

const labelClass =
  "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]";

const errorClass =
  "font-[family-name:var(--font-landing-mono)] text-[11px] text-[var(--color-landing-red)]";

const ctaClass =
  "rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)] disabled:opacity-60";

const linkBack =
  "self-start font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--color-landing-text-muted)] underline-offset-4 transition-colors hover:text-[var(--color-landing-text)] hover:underline";

/**
 * Página /forgot-password.
 *
 * Form con un solo input (DNI). Submit dispara el endpoint backend
 * /auth/forgot-password. La respuesta es siempre genérica, sin
 * confirmar si el DNI existe (anti-enumeration).
 */
export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { dni: "" },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await forgotPassword({ dni: values.dni });
    } catch {
      // Silenciamos: la respuesta al usuario es genérica de igual modo.
    } finally {
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-12 md:py-20">
        <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-green)]">
          Listo
        </div>
        <h1 className="font-[family-name:var(--font-landing-display)] text-4xl uppercase leading-[0.85] tracking-tight md:text-5xl">
          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
            Revisá WhatsApp.
          </span>
        </h1>
        <p className="text-base leading-relaxed text-[var(--color-landing-text-muted)]">
          Si el DNI existe en el sistema, vas a recibir un mensaje por
          WhatsApp con el link para resetear tu contraseña. Llega en unos
          minutos.
        </p>
        <Link href="/login" className={linkBack}>
          ← Volver al login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 md:py-20">
      <Link href="/login" className={`${linkBack} mb-8`}>
        ← Volver al login
      </Link>
      <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        Recuperar acceso
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-4xl uppercase leading-[0.85] tracking-tight md:text-5xl">
        ¿Olvidaste<br />tu contraseña?
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
        Te mandamos un link por WhatsApp para que pongas una nueva.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-10 flex flex-col gap-5"
        noValidate
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="forgot-dni" className={labelClass}>
            DNI
          </label>
          <input
            id="forgot-dni"
            type="text"
            inputMode="numeric"
            autoComplete="username"
            autoFocus
            aria-invalid={!!errors.dni}
            className={inputClass}
            {...register("dni")}
          />
          {errors.dni && <p className={errorClass}>{errors.dni.message}</p>}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className={`${ctaClass} mt-2`}
        >
          {isSubmitting ? "Enviando…" : "Enviar link"}
        </button>
      </form>
    </div>
  );
}

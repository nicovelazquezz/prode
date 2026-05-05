"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPassword } from "@/lib/api/auth";

const schema = z.object({
  dni: z
    .string()
    .min(7)
    .max(8)
    .regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 numeros"),
});

type FormValues = z.infer<typeof schema>;

/**
 * Pagina /forgot-password.
 *
 * Form con un solo input (DNI). Submit dispara el endpoint backend
 * /auth/forgot-password. La respuesta es siempre generica, sin
 * confirmar si el DNI existe (anti-enumeration), y mostramos el
 * mismo mensaje en exito y en error de red para no revelar info.
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
      // Silenciamos: la respuesta al usuario es generica de igual modo.
    } finally {
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-16">
        <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-tight text-[var(--color-prode-near-black)]">
          Listo
        </h1>
        <p className="font-sans text-sm md:text-base text-[var(--color-prode-text-secondary)]">
          Si el DNI existe en el sistema, vas a recibir un mensaje por
          WhatsApp con el link para resetear tu contrasena. Revisa los
          mensajes en unos minutos.
        </p>
        <Link
          href="/login"
          className="mt-4 font-sans text-sm text-[var(--color-prode-near-black)] underline-offset-4 hover:underline"
        >
          Volver al login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-10 md:py-16">
      <Link
        href="/login"
        className="self-start font-sans text-sm text-[var(--color-prode-text-secondary)] mb-8 hover:text-[var(--color-prode-near-black)]"
      >
        ← Volver al login
      </Link>

      <h1 className="font-display text-4xl md:text-5xl font-black uppercase tracking-tight text-[var(--color-prode-near-black)]">
        Recuperá tu acceso
      </h1>
      <p className="mt-3 font-sans text-sm md:text-base text-[var(--color-prode-text-secondary)]">
        Te mandamos un link por WhatsApp para que pongas una contrasena
        nueva.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-10 flex flex-col gap-6"
        noValidate
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="forgot-dni">DNI</Label>
          <Input
            id="forgot-dni"
            type="text"
            inputMode="numeric"
            autoComplete="username"
            autoFocus
            aria-invalid={!!errors.dni}
            {...register("dni")}
          />
          {errors.dni && (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {errors.dni.message}
            </p>
          )}
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? "Enviando..." : "Enviar link"}
        </Button>
      </form>
    </div>
  );
}

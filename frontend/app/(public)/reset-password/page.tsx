"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { resetPassword } from "@/lib/api/auth";

const schema = z
  .object({
    newPassword: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres")
      .regex(/\d/, "La contraseña debe contener al menos un número"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
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
  "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--color-landing-text-muted)] underline-offset-4 transition-colors hover:text-[var(--color-landing-text)] hover:underline";

export default function ResetPasswordPage() {
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
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  if (!token) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-12 md:py-20">
        <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-red)]">
          Link inválido
        </div>
        <h1 className="font-[family-name:var(--font-landing-display)] text-4xl uppercase leading-[0.85] tracking-tight md:text-5xl">
          Algo salió mal.
        </h1>
        <p className="text-base leading-relaxed text-[var(--color-landing-text-muted)]">
          El link no incluye el token de seguridad. Volvé a pedir el reset
          desde &quot;Olvidé mi contraseña&quot;.
        </p>
        <Link href="/forgot-password" className={`${linkBack} self-start`}>
          ← Volver a pedir el link
        </Link>
      </div>
    );
  }

  const onSubmit = async (values: FormValues) => {
    try {
      await resetPassword({ token, newPassword: values.newPassword });
      toast.success("Contraseña actualizada. Ingresá con tu nueva contraseña.");
      router.replace("/login");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "El link expiró o ya fue usado. Pedí uno nuevo.";
      toast.error(msg);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 md:py-20">
      <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        Recuperar acceso
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-4xl uppercase leading-[0.85] tracking-tight md:text-5xl">
        Nueva contraseña.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
        Mínimo 8 caracteres con al menos un número.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-10 flex flex-col gap-5"
        noValidate
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="reset-new" className={labelClass}>
            Contraseña nueva
          </label>
          <div className="relative">
            <input
              id="reset-new"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              className={`${inputClass} pr-12`}
              {...register("newPassword")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)]"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.newPassword && (
            <p className={errorClass}>{errors.newPassword.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="reset-confirm" className={labelClass}>
            Repetí la contraseña
          </label>
          <input
            id="reset-confirm"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className={inputClass}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className={errorClass}>{errors.confirmPassword.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className={`${ctaClass} mt-2`}
        >
          {isSubmitting ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </form>
    </div>
  );
}

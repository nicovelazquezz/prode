"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { useAuth } from "@/lib/hooks/use-auth";

/**
 * Schema de login. DNI argentino: 7 u 8 dígitos. Password: mínimo
 * 1 carácter (la regla real está en backend; acá solo validamos
 * que no esté vacío para que el form arme bien la request).
 */
const loginSchema = z.object({
  dni: z
    .string()
    .min(7, "El DNI debe tener entre 7 y 8 números")
    .max(8, "El DNI debe tener entre 7 y 8 números")
    .regex(/^\d{7,8}$/, "El DNI debe tener solo números (7 u 8 dígitos)"),
  password: z.string().min(1, "Ingresá tu contraseña"),
});

type LoginValues = z.infer<typeof loginSchema>;

const inputClass =
  "w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-4 py-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

const labelClass =
  "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]";

const errorClass =
  "font-[family-name:var(--font-landing-mono)] text-[11px] text-[var(--color-landing-red)]";

/**
 * Página `/login` — DNI + password sobre la estética stadium.
 * Card centrada con surface oscuro, inputs dark, CTA red full-width.
 * Errores via toast. Redirige según rol: USER → /predicciones, ADMIN → /admin.
 */
export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { dni: "", password: "" },
  });

  /**
   * Si el user vino redirigido por sesión expirada (`?returnTo=/predicciones`),
   * después del login lo mandamos de vuelta a esa URL. Validamos que empiece
   * con "/" y NO con "//" para evitar open-redirects (//evil.com sería tomado
   * como external por algunos navegadores).
   */
  const rawReturnTo = searchParams.get("returnTo");
  const safeReturnTo =
    rawReturnTo &&
    rawReturnTo.startsWith("/") &&
    !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : null;

  const onSubmit = async (values: LoginValues) => {
    try {
      const user = await login(values);
      const defaultTarget = user.role === "ADMIN" ? "/admin" : "/predicciones";
      router.replace(safeReturnTo ?? defaultTarget);
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "DNI o contraseña incorrectos";
      toast.error(msg);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 md:py-20">
      <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        Tu cuenta
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-[0.85] tracking-tight md:text-6xl">
        Ingresá.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
        Usá tu DNI y la contraseña que elegiste al registrarte.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-10 flex flex-col gap-5"
        noValidate
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="login-dni" className={labelClass}>
            DNI
          </label>
          <input
            id="login-dni"
            type="text"
            inputMode="numeric"
            autoComplete="username"
            autoFocus
            aria-invalid={!!errors.dni}
            aria-describedby={errors.dni ? "login-dni-error" : undefined}
            className={inputClass}
            {...register("dni")}
          />
          {errors.dni && (
            <p id="login-dni-error" className={errorClass}>
              {errors.dni.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="login-password" className={labelClass}>
            Contraseña
          </label>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              aria-describedby={
                errors.password ? "login-password-error" : undefined
              }
              className={`${inputClass} pr-12`}
              {...register("password")}
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
          {errors.password && (
            <p id="login-password-error" className={errorClass}>
              {errors.password.message}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="mt-2 rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)] disabled:opacity-60"
        >
          {isSubmitting ? "Ingresando…" : "Ingresar"}
        </button>

        <Link
          href="/forgot-password"
          className="self-center font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--color-landing-text-muted)] underline-offset-4 transition-colors hover:text-[var(--color-landing-text)] hover:underline"
        >
          Olvidé mi contraseña
        </Link>
      </form>
    </div>
  );
}

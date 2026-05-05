"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { useAuth } from "@/lib/hooks/use-auth";
import { cn } from "@/lib/utils/cn";

/**
 * Schema de login. DNI argentino: 7 u 8 digitos. Password: minimo
 * 1 caracter (la regla real esta en backend; aca solo validamos
 * que no este vacio para que el form arme bien la request).
 */
const loginSchema = z.object({
  dni: z
    .string()
    .min(7, "El DNI debe tener entre 7 y 8 numeros")
    .max(8, "El DNI debe tener entre 7 y 8 numeros")
    .regex(/^\d{7,8}$/, "El DNI debe tener solo numeros (7 u 8 digitos)"),
  password: z.string().min(1, "Ingresa tu contrasena"),
});

type LoginValues = z.infer<typeof loginSchema>;

/**
 * Pagina `/login` — DNI + password con border-bottom inputs estilo
 * DESIGN.md. CTA primary full-width "INGRESAR" + ghost link a
 * `/forgot-password`. Errores via toast. Redirige segun rol:
 *   - USER  -> /predicciones
 *   - ADMIN -> /admin
 */
export default function LoginPage() {
  const router = useRouter();
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

  const onSubmit = async (values: LoginValues) => {
    try {
      const user = await login(values);
      const target = user.role === "ADMIN" ? "/admin" : "/predicciones";
      router.replace(target);
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "DNI o contrasena incorrectos";
      toast.error(msg);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-10 md:py-16">
      <button
        type="button"
        onClick={() => router.back()}
        className="self-start font-sans text-sm text-[var(--color-prode-text-secondary)] mb-8 hover:text-[var(--color-prode-near-black)]"
      >
        ← Volver
      </button>

      <h1 className="font-display text-5xl md:text-6xl font-black uppercase tracking-tight text-[var(--color-prode-near-black)]">
        Ingresa
      </h1>
      <p className="mt-3 font-sans text-sm text-[var(--color-prode-text-secondary)]">
        Usa tu DNI y la contrasena que elegiste al registrarte.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-10 flex flex-col gap-6"
        noValidate
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="login-dni">DNI</Label>
          <Input
            id="login-dni"
            type="text"
            inputMode="numeric"
            autoComplete="username"
            autoFocus
            aria-invalid={!!errors.dni}
            aria-describedby={errors.dni ? "login-dni-error" : undefined}
            {...register("dni")}
          />
          {errors.dni && (
            <p
              id="login-dni-error"
              className="font-sans text-xs text-[var(--color-prode-accent)]"
            >
              {errors.dni.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="login-password">Contrasena</Label>
          <div className="relative">
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              aria-describedby={
                errors.password ? "login-password-error" : undefined
              }
              {...register("password")}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
              className={cn(
                "absolute right-0 top-1/2 -translate-y-1/2",
                "p-2 text-[var(--color-prode-text-secondary)]",
                "hover:text-[var(--color-prode-near-black)]",
              )}
            >
              {showPassword ? (
                <EyeOff size={18} />
              ) : (
                <Eye size={18} />
              )}
            </button>
          </div>
          {errors.password && (
            <p
              id="login-password-error"
              className="font-sans text-xs text-[var(--color-prode-accent)]"
            >
              {errors.password.message}
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
          {isSubmitting ? "Ingresando..." : "Ingresar"}
        </Button>

        <Link
          href="/forgot-password"
          className="self-center font-sans text-sm text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)] underline-offset-4 hover:underline"
        >
          Olvide mi contrasena
        </Link>
      </form>
    </div>
  );
}

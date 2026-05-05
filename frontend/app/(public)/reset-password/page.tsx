"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { resetPassword } from "@/lib/api/auth";

/**
 * Schema con regla de password identica a complete-registration y
 * confirmacion (UX standard). Backend solo valida la newPassword;
 * el match es 100% UI.
 */
const schema = z
  .object({
    newPassword: z
      .string()
      .min(8, "La contrasena debe tener al menos 8 caracteres")
      .regex(/\d/, "La contrasena debe contener al menos un numero"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contrasenas no coinciden",
  });

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
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
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-16">
        <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-tight text-[var(--color-prode-accent)]">
          Link invalido
        </h1>
        <p className="font-sans text-sm md:text-base text-[var(--color-prode-text-secondary)]">
          El link no incluye el token de seguridad. Volve a pedir el
          reset desde &quot;Olvide mi contrasena&quot;.
        </p>
        <Link
          href="/forgot-password"
          className="mt-2 font-sans text-sm text-[var(--color-prode-near-black)] underline-offset-4 hover:underline"
        >
          Volver a pedir el link
        </Link>
      </div>
    );
  }

  const onSubmit = async (values: FormValues) => {
    try {
      await resetPassword({ token, newPassword: values.newPassword });
      toast.success("Contrasena actualizada. Ingresá con tu nueva contrasena.");
      router.replace("/login");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "El link expiro o ya fue usado. Pedi uno nuevo.";
      toast.error(msg);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-10 md:py-16">
      <h1 className="font-display text-4xl md:text-5xl font-black uppercase tracking-tight text-[var(--color-prode-near-black)]">
        Nueva contrasena
      </h1>
      <p className="mt-3 font-sans text-sm md:text-base text-[var(--color-prode-text-secondary)]">
        Elegi una contrasena nueva. Minimo 8 caracteres con al menos un
        numero.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-10 flex flex-col gap-6"
        noValidate
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="reset-new">Contrasena nueva</Label>
          <div className="relative">
            <Input
              id="reset-new"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              {...register("newPassword")}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={
                showPassword ? "Ocultar contrasena" : "Mostrar contrasena"
              }
              className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)]"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.newPassword && (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {errors.newPassword.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="reset-confirm">Repeti la contrasena</Label>
          <Input
            id="reset-confirm"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {errors.confirmPassword.message}
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
          {isSubmitting ? "Guardando..." : "Cambiar contrasena"}
        </Button>
      </form>
    </div>
  );
}

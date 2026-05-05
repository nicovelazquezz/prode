"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { completeRegistration } from "@/lib/api/auth";
import { getPaymentByToken } from "@/lib/api/payments";
import { queryKeys } from "@/lib/api/queryKeys";
import { useAuth } from "@/lib/hooks/use-auth";
import { cn } from "@/lib/utils/cn";

const ADMIN_WHATSAPP = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? "";

/**
 * Schema de completar-registro. Validaciones espejadas con backend:
 *   - DNI: 7-8 digitos
 *   - WhatsApp: 10 a 13 digitos del area+numero (luego se prefija
 *     "549" -> resultado "549<digits>" coincide con `^\d{10,15}$`)
 *   - password: 8+ chars con al menos un digito (regla backend)
 */
const schema = z.object({
  dni: z
    .string()
    .min(7)
    .max(8)
    .regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 numeros"),
  firstName: z.string().min(1, "Ingresa tu nombre").max(60),
  lastName: z.string().min(1, "Ingresa tu apellido").max(60),
  // El usuario tipea: codigo de area + numero (sin 549). Ej: 2914123456.
  whatsappRaw: z
    .string()
    .min(10, "Codigo de area + numero (10 a 13 digitos)")
    .max(13, "Codigo de area + numero (10 a 13 digitos)")
    .regex(/^\d{10,13}$/, "Solo numeros, sin espacios ni guiones"),
  password: z
    .string()
    .min(8, "La contrasena debe tener al menos 8 caracteres")
    .regex(/\d/, "La contrasena debe contener al menos un numero"),
});

type FormValues = z.infer<typeof schema>;

function buildAdminWhatsApp(): string {
  const text = encodeURIComponent(
    "Hola! Pague pero el link de registro me da error.",
  );
  const num = ADMIN_WHATSAPP.replace(/\D/g, "");
  return num
    ? `https://wa.me/${num}?text=${text}`
    : `https://wa.me/?text=${text}`;
}

/**
 * Pagina /completar-registro?token=xxx.
 *
 * Flow:
 *   1. Lee `?token=` con useSearchParams.
 *   2. Valida con GET /payments/by-token/:token (useQuery).
 *      - 404 / 410 / network error -> pantalla error con CTA WhatsApp.
 *   3. OK -> form con DNI / nombre / apellido / WhatsApp / password.
 *   4. Submit -> completeRegistration() -> redirect /predicciones.
 *
 * UX:
 *   - Mobile: 3 steps con stepper (DNI+nombre / WhatsApp / password).
 *   - Desktop: single page con secciones. Implementado via responsive
 *     hide/show de steps (Tailwind), manteniendo un solo form.
 */
/**
 * Wrapper que provee el Suspense boundary requerido por
 * `useSearchParams()` en client components prerenderizados.
 * Sin Suspense, Next 16 falla el build estatico ("missing-suspense-
 * with-csr-bailout"). El fallback es un placeholder minimo.
 */
export default function CompletarRegistroPage() {
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
      <CompletarRegistroForm />
    </Suspense>
  );
}

function CompletarRegistroForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();
  const token = searchParams.get("token") ?? "";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      dni: "",
      firstName: "",
      lastName: "",
      whatsappRaw: "",
      password: "",
    },
    mode: "onTouched",
  });

  const tokenQuery = useQuery({
    queryKey: queryKeys.payments.byToken(token),
    queryFn: () => getPaymentByToken(token),
    enabled: !!token,
    retry: false,
    staleTime: 60_000,
  });

  // ── Token vacio o invalido ────────────────────────────────────
  if (!token) {
    return (
      <ErrorPanel
        title="Link invalido"
        description="No encontramos el token de pago en la URL. Pedile al admin que te reenvie el link."
      />
    );
  }

  if (tokenQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-16">
        <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
          Validando tu pago...
        </p>
      </div>
    );
  }

  if (tokenQuery.isError || !tokenQuery.data) {
    return (
      <ErrorPanel
        title="No pudimos validar tu pago"
        description="El link expiro o ya fue usado. Si pagaste y este es el link que recibiste, escribinos por WhatsApp y lo destrabamos."
      />
    );
  }

  const onSubmit = async (values: FormValues) => {
    // Normalizamos a 549<area+numero>: el regex backend es ^\d{10,15}$.
    const whatsappNormalized = `549${values.whatsappRaw}`;
    try {
      await completeRegistration({
        token,
        dni: values.dni,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        whatsapp: whatsappNormalized,
        password: values.password,
      });
      // Hidratar el AuthProvider con el user nuevo.
      await refresh();
      router.replace("/predicciones");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "No pudimos completar el registro";
      toast.error(msg);
    }
  };

  const goNext = async () => {
    if (step === 1) {
      const ok = await trigger(["dni", "firstName", "lastName"]);
      if (ok) setStep(2);
      return;
    }
    if (step === 2) {
      const ok = await trigger(["whatsappRaw"]);
      if (ok) setStep(3);
    }
  };

  const goBack = () => setStep((s) => (s === 1 ? 1 : ((s - 1) as 1 | 2 | 3)));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-4 py-10 md:py-16">
      <h1 className="font-display text-4xl md:text-6xl font-black uppercase tracking-tight text-[var(--color-prode-near-black)]">
        Completá tu registro
      </h1>
      <p className="mt-3 font-sans text-sm md:text-base text-[var(--color-prode-text-secondary)]">
        Pago confirmado. Solo nos faltan tus datos para que puedas
        cargar las predicciones.
      </p>

      {/* Stepper visible solo en mobile */}
      <div className="md:hidden mt-8">
        <Stepper current={step} total={3} />
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-8 flex flex-col gap-8"
        noValidate
      >
        {/* Step 1: DNI + nombre + apellido */}
        <section
          className={cn(
            "flex flex-col gap-6",
            step !== 1 && "hidden md:flex",
          )}
        >
          <h2 className="font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)] md:text-2xl">
            1. Tus datos
          </h2>

          <Field
            label="DNI"
            id="reg-dni"
            error={errors.dni?.message}
          >
            <Input
              id="reg-dni"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              {...register("dni")}
            />
          </Field>

          <Field
            label="Nombre"
            id="reg-first"
            error={errors.firstName?.message}
          >
            <Input
              id="reg-first"
              type="text"
              autoComplete="given-name"
              {...register("firstName")}
            />
          </Field>

          <Field
            label="Apellido"
            id="reg-last"
            error={errors.lastName?.message}
          >
            <Input
              id="reg-last"
              type="text"
              autoComplete="family-name"
              {...register("lastName")}
            />
          </Field>
        </section>

        {/* Step 2: WhatsApp */}
        <section
          className={cn(
            "flex flex-col gap-6",
            step !== 2 && "hidden md:flex",
          )}
        >
          <h2 className="font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)] md:text-2xl">
            2. WhatsApp
          </h2>
          <p className="font-sans text-sm text-[var(--color-prode-text-secondary)] -mt-3">
            Por aca te avisamos cuando hay novedades del Prode. El
            prefijo +54 9 ya esta puesto, vos solo tipeas el codigo de
            area + numero (ej: 2914123456 para Bahia Blanca, 11xxxxxxxx
            para CABA).
          </p>

          <Field
            label="WhatsApp"
            id="reg-whatsapp"
            error={errors.whatsappRaw?.message}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="select-none font-sans text-base font-medium text-[var(--color-prode-text-secondary)] tabular-nums"
              >
                +54 9
              </span>
              <Input
                id="reg-whatsapp"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="2914123456"
                {...register("whatsappRaw")}
              />
            </div>
          </Field>
        </section>

        {/* Step 3: Password */}
        <section
          className={cn(
            "flex flex-col gap-6",
            step !== 3 && "hidden md:flex",
          )}
        >
          <h2 className="font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)] md:text-2xl">
            3. Contrasena
          </h2>
          <p className="font-sans text-sm text-[var(--color-prode-text-secondary)] -mt-3">
            Minimo 8 caracteres con al menos un numero. Vas a usarla
            con tu DNI cada vez que entres al Prode.
          </p>

          <Field
            label="Contrasena"
            id="reg-password"
            error={errors.password?.message}
          >
            <div className="relative">
              <Input
                id="reg-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                {...register("password")}
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
          </Field>
        </section>

        {/* Footer: en mobile cambia segun step. En desktop = solo submit. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end md:gap-4">
          {/* Mobile-only navigation */}
          <div className="md:hidden flex flex-col gap-3">
            {step < 3 ? (
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full"
                onClick={goNext}
              >
                Continuar
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? "Guardando..." : "Completar registro"}
              </Button>
            )}
            {step > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={goBack}
              >
                Volver
              </Button>
            )}
          </div>

          {/* Desktop: single submit */}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="hidden md:inline-flex md:w-auto md:px-12"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Guardando..." : "Completar registro"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p className="font-sans text-xs text-[var(--color-prode-accent)]">
          {error}
        </p>
      )}
    </div>
  );
}

function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progreso del registro">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <li
          key={n}
          aria-current={n === current ? "step" : undefined}
          className={cn(
            "flex h-2 flex-1 rounded-pill",
            n <= current
              ? "bg-[var(--color-prode-near-black)]"
              : "bg-[var(--color-prode-border)]",
          )}
        />
      ))}
    </ol>
  );
}

function ErrorPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-start gap-4 px-4 py-16">
      <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-tight text-[var(--color-prode-accent)]">
        {title}
      </h1>
      <p className="font-sans text-sm md:text-base text-[var(--color-prode-text-secondary)]">
        {description}
      </p>
      <a
        href={buildAdminWhatsApp()}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "mt-2 inline-flex h-12 items-center justify-center rounded-2xl px-8",
          "bg-[var(--color-prode-near-black)] text-white text-sm font-medium font-sans",
          "hover:opacity-90",
        )}
      >
        Contactar admin por WhatsApp
      </a>
      <Link
        href="/"
        className="font-sans text-sm text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)]"
      >
        Volver al inicio
      </Link>
    </div>
  );
}

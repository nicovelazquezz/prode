"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { completeRegistration } from "@/lib/api/auth";
import { getPaymentByToken } from "@/lib/api/payments";
import { queryKeys } from "@/lib/api/queryKeys";
import { useAuth } from "@/lib/hooks/use-auth";
import { cn } from "@/lib/utils/cn";

const ADMIN_WHATSAPP = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? "";

const schema = z.object({
  dni: z
    .string()
    .min(7)
    .max(8)
    .regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 números"),
  firstName: z.string().min(1, "Ingresá tu nombre").max(60),
  lastName: z.string().min(1, "Ingresá tu apellido").max(60),
  whatsappRaw: z
    .string()
    .min(10, "Código de área + número (10 a 12 dígitos)")
    .max(12, "Código de área + número (10 a 12 dígitos)")
    .regex(/^\d{10,12}$/, "Solo números, sin espacios ni guiones"),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .regex(/\d/, "La contraseña debe contener al menos un número"),
});

type FormValues = z.infer<typeof schema>;

const inputClass =
  "w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-4 py-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

const labelClass =
  "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]";

const errorClass =
  "font-[family-name:var(--font-landing-mono)] text-[11px] text-[var(--color-landing-red)]";

const ctaPrimary =
  "rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)] disabled:opacity-60";

const ctaGhost =
  "rounded-sm border border-[var(--color-landing-line-strong)] px-8 py-[18px] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]";

function buildAdminWhatsApp(): string {
  const text = encodeURIComponent(
    "Hola! Pagué pero el link de registro me da error.",
  );
  const num = ADMIN_WHATSAPP.replace(/\D/g, "");
  return num
    ? `https://wa.me/${num}?text=${text}`
    : `https://wa.me/?text=${text}`;
}

export default function CompletarRegistroPage() {
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

  if (!token) {
    return (
      <ErrorPanel
        title="Link inválido"
        description="No encontramos el token de pago en la URL. Pedile al admin que te reenvíe el link."
      />
    );
  }

  if (tokenQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-16">
        <p className="font-[family-name:var(--font-landing-mono)] text-xs uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
          Validando tu pago…
        </p>
      </div>
    );
  }

  if (tokenQuery.isError || !tokenQuery.data) {
    return (
      <ErrorPanel
        title="No pudimos validar tu pago"
        description="El link expiró o ya fue usado. Si pagaste y este es el link que recibiste, escribinos por WhatsApp y lo destrabamos."
      />
    );
  }

  const onSubmit = async (values: FormValues) => {
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
    <div className="mx-auto flex w-full max-w-2xl flex-col px-4 py-12 md:py-20">
      <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-green)]">
        Pago confirmado
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-4xl uppercase leading-[0.85] tracking-tight md:text-6xl">
        <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
          Completá tu registro.
        </span>
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--color-landing-text-muted)] md:text-base">
        Solo nos faltan tus datos para que puedas cargar predicciones.
      </p>

      <div className="md:hidden mt-8">
        <Stepper current={step} total={3} />
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-8 flex flex-col gap-8"
        noValidate
      >
        <section
          className={cn(
            "flex flex-col gap-5",
            step !== 1 && "hidden md:flex",
          )}
        >
          <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight">
            01 · Tus datos
          </h2>

          <Field label="DNI" id="reg-dni" error={errors.dni?.message}>
            <input
              id="reg-dni"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className={inputClass}
              {...register("dni")}
            />
          </Field>

          <Field label="Nombre" id="reg-first" error={errors.firstName?.message}>
            <input
              id="reg-first"
              type="text"
              autoComplete="given-name"
              className={inputClass}
              {...register("firstName")}
            />
          </Field>

          <Field label="Apellido" id="reg-last" error={errors.lastName?.message}>
            <input
              id="reg-last"
              type="text"
              autoComplete="family-name"
              className={inputClass}
              {...register("lastName")}
            />
          </Field>
        </section>

        <section
          className={cn(
            "flex flex-col gap-5",
            step !== 2 && "hidden md:flex",
          )}
        >
          <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight">
            02 · WhatsApp
          </h2>
          <p className="-mt-2 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            Por acá te avisamos novedades del Prode. El prefijo +54 9 ya
            está puesto, vos solo tipeás código de área + número (ej:
            2914123456 para Bahía Blanca).
          </p>

          <Field
            label="WhatsApp"
            id="reg-whatsapp"
            error={errors.whatsappRaw?.message}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="select-none font-[family-name:var(--font-landing-mono)] text-base text-[var(--color-landing-text-muted)] tabular-nums"
              >
                +54 9
              </span>
              <input
                id="reg-whatsapp"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="2914123456"
                className={inputClass}
                {...register("whatsappRaw")}
              />
            </div>
          </Field>
        </section>

        <section
          className={cn(
            "flex flex-col gap-5",
            step !== 3 && "hidden md:flex",
          )}
        >
          <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight">
            03 · Contraseña
          </h2>
          <p className="-mt-2 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            Mínimo 8 caracteres con al menos un número. Vas a usarla con
            tu DNI cada vez que entres al Prode.
          </p>

          <Field
            label="Contraseña"
            id="reg-password"
            error={errors.password?.message}
          >
            <div className="relative">
              <input
                id="reg-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                className={`${inputClass} pr-12`}
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={
                  showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)]"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
        </section>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end md:gap-4">
          <div className="md:hidden flex flex-col gap-3">
            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                className={`${ctaPrimary} w-full`}
              >
                Continuar
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className={`${ctaPrimary} w-full`}
              >
                {isSubmitting ? "Guardando…" : "Completar registro"}
              </button>
            )}
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                className={`${ctaGhost} w-full`}
              >
                Volver
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className={`${ctaPrimary} hidden md:inline-flex md:px-12`}
          >
            {isSubmitting ? "Guardando…" : "Completar registro"}
          </button>
        </div>
      </form>
    </div>
  );
}

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
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {error && <p className={errorClass}>{error}</p>}
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
            "flex h-1 flex-1 rounded-full",
            n <= current
              ? "bg-[var(--color-landing-green)]"
              : "bg-[var(--color-landing-line-strong)]",
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
    <div className="mx-auto flex w-full max-w-md flex-col items-start gap-5 px-4 py-16">
      <div className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-red)]">
        Algo salió mal
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-3xl uppercase leading-[0.9] tracking-tight md:text-4xl">
        {title}
      </h1>
      <p className="text-sm leading-relaxed text-[var(--color-landing-text-muted)] md:text-base">
        {description}
      </p>
      <a
        href={buildAdminWhatsApp()}
        target="_blank"
        rel="noopener noreferrer"
        className={ctaPrimary}
      >
        Contactar admin por WhatsApp
      </a>
      <Link
        href="/"
        className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--color-landing-text-muted)] underline-offset-4 transition-colors hover:text-[var(--color-landing-text)] hover:underline"
      >
        Volver al inicio
      </Link>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { HTTPError } from "ky";
import { toast } from "sonner";
import { LogOut, Save, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { IosInstallHint } from "@/components/domain/ios-install-hint";
import { useAuth } from "@/lib/hooks/use-auth";
import { changePassword } from "@/lib/api/auth";
import { cn } from "@/lib/utils/cn";

/**
 * /perfil — datos personales (read-only), editables (whatsapp +
 * notificaciones), cambio de password, hint instalar app, logout.
 *
 * Visual: dark editorial. Cada section es un card de surface bg con
 * border line-strong. Inputs surface bg + line-strong border, focus
 * outline gold + green underline. Logout outlined con border-strong.
 */

const sectionTitle =
  "font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight leading-none text-[var(--color-landing-text)]";

const labelClasses =
  "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]";

const inputClasses =
  "h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] focus:border-[var(--color-landing-green)]";

const errorText =
  "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-red)]";

const cardSurface =
  "rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5";

const buttonPrimary =
  "inline-flex items-center justify-center gap-2 rounded-sm bg-[var(--color-landing-red)] px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] disabled:cursor-not-allowed disabled:opacity-40";

const buttonOutlined =
  "inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

export default function PerfilPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  if (!user) {
    return (
      <section className="mx-auto max-w-xl px-4 py-12 text-center">
        <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
          Cargando perfil...
        </p>
      </section>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <section className="mx-auto max-w-xl px-4 pb-20 pt-10 md:px-8 md:pb-24 md:pt-14 space-y-10">
      <header>
        <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Tu cuenta
        </div>
        <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">
          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
            Perfil.
          </span>
        </h1>
      </header>

      <PersonalDataSection
        dni={user.dni}
        firstName={user.firstName}
        lastName={user.lastName}
        role={user.role}
      />

      <ContactSection
        whatsapp={user.whatsapp}
        whatsappOptIn={user.whatsappOptIn}
      />

      <ChangePasswordSection />

      <section aria-labelledby="install-section-title" className="space-y-3">
        <h2 id="install-section-title" className={sectionTitle}>
          Instalar app
        </h2>
        <IosInstallHint />
      </section>

      <section className="border-t border-[var(--color-landing-line-strong)] pt-8">
        <button
          type="button"
          onClick={handleLogout}
          className={cn(buttonOutlined, "w-full")}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Cerrar sesión
        </button>
      </section>
    </section>
  );
}

function PersonalDataSection({
  dni,
  firstName,
  lastName,
  role,
}: {
  dni: string;
  firstName: string;
  lastName: string;
  role: "USER" | "ADMIN";
}) {
  return (
    <section aria-labelledby="personal-section-title" className="space-y-3">
      <h2 id="personal-section-title" className={sectionTitle}>
        Datos personales
      </h2>
      <dl className={cn("grid grid-cols-1 sm:grid-cols-2 gap-5", cardSurface)}>
        <Field label="DNI" value={dni} />
        <Field label="Nombre" value={firstName} />
        <Field label="Apellido" value={lastName} />
        <div className="flex flex-col gap-1.5">
          <dt className={labelClasses}>Rol</dt>
          <dd>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-landing-text)]",
                role === "ADMIN"
                  ? "bg-[var(--color-landing-red)]"
                  : "bg-[var(--color-landing-green)]",
              )}
            >
              <ShieldCheck className="h-3 w-3" aria-hidden />
              {role === "ADMIN" ? "Admin" : "Usuario"}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className={labelClasses}>{label}</dt>
      <dd className="font-sans text-base text-[var(--color-landing-text)]">
        {value}
      </dd>
    </div>
  );
}

const whatsappSchema = z.object({
  whatsapp: z
    .string()
    .min(8, "Numero invalido")
    .max(20, "Numero invalido")
    .regex(/^\+?[\d\s-]+$/i, "Solo digitos, espacios, guiones y +"),
  whatsappOptIn: z.boolean(),
});
type WhatsappForm = z.infer<typeof whatsappSchema>;

function ContactSection({
  whatsapp,
  whatsappOptIn,
}: {
  whatsapp: string;
  whatsappOptIn: boolean;
}) {
  const [confirmDialog, setConfirmDialog] = useState<WhatsappForm | null>(null);

  const form = useForm<WhatsappForm>({
    resolver: zodResolver(whatsappSchema),
    defaultValues: {
      whatsapp,
      whatsappOptIn,
    },
  });

  const saveWhatsapp = (data: WhatsappForm) => {
    void data;
    toast.success("Cambios guardados (mock — backend pendiente).");
    form.reset(data);
    setConfirmDialog(null);
  };

  const onSubmit = (data: WhatsappForm) => {
    if (data.whatsapp !== whatsapp) {
      setConfirmDialog(data);
    } else {
      saveWhatsapp(data);
    }
  };

  return (
    <section aria-labelledby="contact-section-title" className="space-y-3">
      <h2 id="contact-section-title" className={sectionTitle}>
        Contacto
      </h2>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn("space-y-5", cardSurface)}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="whatsapp" className={labelClasses}>
            WhatsApp
          </label>
          <input
            id="whatsapp"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-invalid={form.formState.errors.whatsapp ? "true" : "false"}
            className={inputClasses}
            {...form.register("whatsapp")}
          />
          {form.formState.errors.whatsapp ? (
            <p className={errorText}>
              {form.formState.errors.whatsapp.message}
            </p>
          ) : null}
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className={cn(
              "mt-1 h-5 w-5 shrink-0 rounded-sm appearance-none cursor-pointer",
              "border-2 border-[var(--color-landing-line-strong)] bg-transparent",
              "checked:bg-[var(--color-landing-green)] checked:border-[var(--color-landing-green)]",
              "checked:bg-[length:14px_14px] checked:bg-no-repeat checked:bg-center",
              "checked:[background-image:url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23f1ece0%22%20stroke-width=%223%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22><polyline%20points=%2220%206%209%2017%204%2012%22/></svg>')]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
            )}
            {...form.register("whatsappOptIn")}
          />
          <div className="min-w-0">
            <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text)]">
              Recibir notificaciones por WhatsApp
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-landing-text-muted)]">
              Recordatorios de partidos y resultados.
            </p>
          </div>
        </label>

        <button
          type="submit"
          disabled={!form.formState.isDirty}
          className={buttonPrimary}
        >
          <Save className="h-4 w-4" aria-hidden />
          Guardar cambios
        </button>
      </form>

      <Dialog
        open={confirmDialog !== null}
        onOpenChange={(o) => !o && setConfirmDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
              Confirmar cambio
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
              Vamos a actualizar tu número de WhatsApp a{" "}
              <span className="font-[family-name:var(--font-landing-mono)] text-[var(--color-landing-gold)]">
                {confirmDialog?.whatsapp}
              </span>
              . Es por acá que vas a recibir todas las notificaciones.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-stretch">
            <button
              type="button"
              onClick={() => setConfirmDialog(null)}
              className={cn(buttonOutlined, "flex-1")}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => confirmDialog && saveWhatsapp(confirmDialog)}
              className={cn(buttonPrimary, "flex-1")}
            >
              Confirmar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Requerida"),
    newPassword: z
      .string()
      .min(8, "Minimo 8 caracteres")
      .regex(/\d/, "Debe contener al menos un numero"),
    confirmNewPassword: z.string().min(1, "Requerida"),
  })
  .refine((d) => d.newPassword === d.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "Las contrasenas no coinciden",
  });
type PasswordForm = z.infer<typeof passwordSchema>;

function ChangePasswordSection() {
  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (dto: { currentPassword: string; newPassword: string }) =>
      changePassword(dto),
    onSuccess: () => {
      toast.success(
        "Contrasena actualizada. Tendras que volver a iniciar sesion en otros dispositivos.",
      );
      form.reset();
    },
    onError: async (err: Error) => {
      let message = "No pudimos cambiar la contrasena.";
      if (err instanceof HTTPError && err.response.status === 400) {
        try {
          const body = (await err.response.clone().json()) as {
            message?: string;
          };
          if (body?.message) message = body.message;
        } catch {
          message = "Contrasena actual incorrecta.";
        }
      }
      toast.error(message);
    },
  });

  const onSubmit = (data: PasswordForm) => {
    mutation.mutate({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
    });
  };

  return (
    <section aria-labelledby="password-section-title" className="space-y-3">
      <h2 id="password-section-title" className={sectionTitle}>
        Cambiar contraseña
      </h2>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn("space-y-5", cardSurface)}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="currentPassword" className={labelClasses}>
            Contraseña actual
          </label>
          <input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            aria-invalid={
              form.formState.errors.currentPassword ? "true" : "false"
            }
            className={inputClasses}
            {...form.register("currentPassword")}
          />
          {form.formState.errors.currentPassword ? (
            <p className={errorText}>
              {form.formState.errors.currentPassword.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="newPassword" className={labelClasses}>
            Contraseña nueva
          </label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={form.formState.errors.newPassword ? "true" : "false"}
            className={inputClasses}
            {...form.register("newPassword")}
          />
          {form.formState.errors.newPassword ? (
            <p className={errorText}>
              {form.formState.errors.newPassword.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="confirmNewPassword" className={labelClasses}>
            Repetir nueva contraseña
          </label>
          <input
            id="confirmNewPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={
              form.formState.errors.confirmNewPassword ? "true" : "false"
            }
            className={inputClasses}
            {...form.register("confirmNewPassword")}
          />
          {form.formState.errors.confirmNewPassword ? (
            <p className={errorText}>
              {form.formState.errors.confirmNewPassword.message}
            </p>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-[var(--color-landing-text-muted)]">
          Tendrás que volver a iniciar sesión en otros dispositivos.
        </p>
        <button
          type="submit"
          disabled={mutation.isPending}
          className={buttonPrimary}
        >
          {mutation.isPending ? "Cambiando..." : "Cambiar contraseña"}
        </button>
      </form>
    </section>
  );
}

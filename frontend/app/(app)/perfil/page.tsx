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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IosInstallHint } from "@/components/domain/ios-install-hint";
import { useAuth } from "@/lib/hooks/use-auth";
import { changePassword } from "@/lib/api/auth";
import { cn } from "@/lib/utils/cn";

/**
 * /perfil — datos personales (read-only), editables (whatsapp +
 * notificaciones), cambio de password, hint instalar app, logout.
 *
 * El endpoint para actualizar whatsapp / opt-in no esta documentado
 * en el plan; dejamos UI con mutation TODO para conectar cuando el
 * backend exponga PATCH /auth/me o equivalente.
 */
export default function PerfilPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  if (!user) {
    return (
      <section className="mx-auto max-w-xl px-4 py-12 text-center">
        <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
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
    <section className="mx-auto max-w-xl px-4 py-6 md:px-8 space-y-8">
      <header>
        <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide leading-none text-[var(--color-prode-near-black)]">
          Mi perfil
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

      <section
        aria-labelledby="install-section-title"
        className="space-y-3"
      >
        <h2
          id="install-section-title"
          className="font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]"
        >
          Instalar app
        </h2>
        <IosInstallHint />
      </section>

      <section className="border-t border-[var(--color-prode-border)] pt-6">
        <Button
          type="button"
          variant="outlined"
          size="lg"
          onClick={handleLogout}
          className="w-full justify-center gap-2"
        >
          <LogOut className="h-5 w-5" aria-hidden />
          Cerrar sesion
        </Button>
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
    <section
      aria-labelledby="personal-section-title"
      className="space-y-3"
    >
      <h2
        id="personal-section-title"
        className="font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]"
      >
        Datos personales
      </h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md border border-[var(--color-prode-border)] bg-white p-4">
        <Field label="DNI" value={dni} />
        <Field label="Nombre" value={firstName} />
        <Field label="Apellido" value={lastName} />
        <div className="flex flex-col gap-1">
          <dt className="font-sans text-[11px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Rol
          </dt>
          <dd>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-sans text-xs font-bold uppercase tracking-wider",
                role === "ADMIN"
                  ? "bg-[var(--color-prode-accent)] text-white"
                  : "bg-[var(--color-prode-near-black)] text-white",
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
    <div className="flex flex-col gap-1">
      <dt className="font-sans text-[11px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
        {label}
      </dt>
      <dd className="font-sans text-base text-[var(--color-prode-near-black)]">
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

  // TODO(backend): cuando el backend exponga PATCH /auth/me (o
  // /users/me), conectar la mutation. Por ahora muestra toast con
  // confirmacion visual para que el flujo UI quede testeado.
  const saveWhatsapp = (data: WhatsappForm) => {
    // Placeholder: replace with `updateMe(data)` when backend ships.
    void data;
    toast.success("Cambios guardados (mock — backend pendiente).");
    form.reset(data);
    setConfirmDialog(null);
  };

  const onSubmit = (data: WhatsappForm) => {
    if (data.whatsapp !== whatsapp) {
      // El cambio de numero requiere confirmacion explicita.
      setConfirmDialog(data);
    } else {
      saveWhatsapp(data);
    }
  };

  return (
    <section
      aria-labelledby="contact-section-title"
      className="space-y-3"
    >
      <h2
        id="contact-section-title"
        className="font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]"
      >
        Contacto
      </h2>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 rounded-md border border-[var(--color-prode-border)] bg-white p-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input
            id="whatsapp"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-invalid={form.formState.errors.whatsapp ? "true" : "false"}
            {...form.register("whatsapp")}
          />
          {form.formState.errors.whatsapp ? (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {form.formState.errors.whatsapp.message}
            </p>
          ) : null}
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className={cn(
              "mt-1 h-5 w-5 shrink-0 rounded border-2 border-[var(--color-prode-border)]",
              "checked:bg-[var(--color-prode-near-black)] checked:border-[var(--color-prode-near-black)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-offset-2",
            )}
            {...form.register("whatsappOptIn")}
          />
          <div className="min-w-0">
            <p className="font-sans text-sm font-medium text-[var(--color-prode-near-black)]">
              Recibir notificaciones por WhatsApp
            </p>
            <p className="font-sans text-xs text-[var(--color-prode-text-secondary)]">
              Recordatorios de partidos y resultados.
            </p>
          </div>
        </label>

        <Button
          type="submit"
          variant="primary"
          size="default"
          disabled={!form.formState.isDirty}
          className="gap-2"
        >
          <Save className="h-4 w-4" aria-hidden />
          Guardar cambios
        </Button>
      </form>

      <Dialog
        open={confirmDialog !== null}
        onOpenChange={(o) => !o && setConfirmDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar cambio</DialogTitle>
            <DialogDescription>
              Vamos a actualizar tu numero de WhatsApp a{" "}
              <span className="font-bold text-[var(--color-prode-near-black)]">
                {confirmDialog?.whatsapp}
              </span>
              . Es por aca que vas a recibir todas las notificaciones.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDialog(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => confirmDialog && saveWhatsapp(confirmDialog)}
            >
              Confirmar
            </Button>
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
    <section
      aria-labelledby="password-section-title"
      className="space-y-3"
    >
      <h2
        id="password-section-title"
        className="font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]"
      >
        Cambiar contrasena
      </h2>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 rounded-md border border-[var(--color-prode-border)] bg-white p-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="currentPassword">Contrasena actual</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            aria-invalid={
              form.formState.errors.currentPassword ? "true" : "false"
            }
            {...form.register("currentPassword")}
          />
          {form.formState.errors.currentPassword ? (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {form.formState.errors.currentPassword.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="newPassword">Contrasena nueva</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={form.formState.errors.newPassword ? "true" : "false"}
            {...form.register("newPassword")}
          />
          {form.formState.errors.newPassword ? (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {form.formState.errors.newPassword.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmNewPassword">Repetir nueva contrasena</Label>
          <Input
            id="confirmNewPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={
              form.formState.errors.confirmNewPassword ? "true" : "false"
            }
            {...form.register("confirmNewPassword")}
          />
          {form.formState.errors.confirmNewPassword ? (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {form.formState.errors.confirmNewPassword.message}
            </p>
          ) : null}
        </div>
        <p className="font-sans text-xs text-[var(--color-prode-text-secondary)]">
          Tendras que volver a iniciar sesion en otros dispositivos.
        </p>
        <Button
          type="submit"
          variant="primary"
          size="default"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Cambiando..." : "Cambiar contrasena"}
        </Button>
      </form>
    </section>
  );
}

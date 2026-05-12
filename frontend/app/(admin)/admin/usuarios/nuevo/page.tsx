"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
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
import { toast } from "@/components/ui/toaster";
import { createManualUser } from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/queryKeys";
import { copyToClipboard, generatePassword } from "@/lib/utils/password";
import { formatARS } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

const schema = z.object({
  dni: z
    .string()
    .min(7, "Minimo 7 digitos")
    .max(10, "Maximo 10 digitos")
    .regex(/^\d+$/, "Solo digitos"),
  firstName: z.string().min(1, "Requerido").max(50, "Maximo 50"),
  lastName: z.string().min(1, "Requerido").max(50, "Maximo 50"),
  whatsapp: z
    .string()
    .min(8, "Minimo 8 digitos")
    .max(20, "Maximo 20")
    .regex(/^[\d+\s\-()]+$/, "Solo digitos y separadores"),
  paymentMethod: z.enum(["CASH", "TRANSFER"]),
  amount: z
    .number({ message: "Numero invalido" })
    .int()
    .min(0, "Minimo 0"),
  notes: z.string().max(500, "Maximo 500").optional().or(z.literal("")),
  password: z
    .string()
    .min(6, "Minimo 6 caracteres")
    .max(64, "Maximo 64 caracteres"),
});

type FormValues = z.infer<typeof schema>;

/**
 * Crear usuario manualmente (spec §6.11). El admin tipea la
 * password (o la genera) y se la pasa al usuario por WhatsApp;
 * el modal post-success es la unica oportunidad de verla en plain.
 *
 * Mobile responsive: form 1 columna en mobile, 2 cols en md+ para
 * algunos campos (nombre, apellido).
 */
export default function NuevoUsuarioPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      dni: "",
      firstName: "",
      lastName: "",
      whatsapp: "",
      paymentMethod: "CASH",
      amount: 15000,
      notes: "",
      password: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (vars: FormValues) =>
      createManualUser({
        dni: vars.dni,
        firstName: vars.firstName,
        lastName: vars.lastName,
        whatsapp: vars.whatsapp,
        password: vars.password,
        amount: vars.amount,
        paymentMethod: vars.paymentMethod,
        notes: vars.notes?.trim() || undefined,
      }),
    onSuccess: (_user, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users.list() });
      setCreatedPassword(vars.password);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos crear el usuario.");
    },
  });

  const onSubmit = (values: FormValues) => {
    createMutation.mutate(values);
  };

  const handleGeneratePassword = () => {
    const next = generatePassword();
    form.setValue("password", next, { shouldValidate: true });
    setShowPassword(true);
  };

  const closeAndRedirect = () => {
    setCreatedPassword(null);
    router.push("/admin/usuarios");
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/admin/usuarios"
        className="inline-flex items-center gap-2 mb-3 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Volver
      </Link>

      <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">Alta manual</div>


      <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">


        <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">


          Nuevo usuario


        </span>


      </h1>
      <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
        Carga manual de un participante (cobro en efectivo o transferencia).
      </p>

      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mt-8 space-y-6"
        noValidate
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field
            label="DNI"
            error={form.formState.errors.dni?.message}
          >
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              {...form.register("dni")}
            />
          </Field>
          <Field
            label="WhatsApp"
            error={form.formState.errors.whatsapp?.message}
          >
            <Input
              type="tel"
              autoComplete="off"
              placeholder="+54 9 11 ..."
              {...form.register("whatsapp")}
            />
          </Field>
          <Field
            label="Nombre"
            error={form.formState.errors.firstName?.message}
          >
            <Input
              type="text"
              autoComplete="off"
              {...form.register("firstName")}
            />
          </Field>
          <Field
            label="Apellido"
            error={form.formState.errors.lastName?.message}
          >
            <Input
              type="text"
              autoComplete="off"
              {...form.register("lastName")}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr]">
          <Field
            label="Metodo de pago"
            error={form.formState.errors.paymentMethod?.message}
          >
            <select
              {...form.register("paymentMethod")}
              className="h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-landing-gold)] focus:ring-offset-2"
            >
              <option value="CASH">Efectivo</option>
              <option value="TRANSFER">Transferencia</option>
            </select>
          </Field>
          <Field
            label={`Monto (default ${formatARS(15000)})`}
            error={form.formState.errors.amount?.message}
          >
            <Input
              type="number"
              inputMode="numeric"
              {...form.register("amount", { valueAsNumber: true })}
            />
          </Field>
        </div>

        <Field
          label="Notas (opcional)"
          error={form.formState.errors.notes?.message}
        >
          <textarea
            rows={3}
            placeholder="Aclaraciones internas..."
            className="w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-landing-gold)] focus:ring-offset-2"
            {...form.register("notes")}
          />
        </Field>

        <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-4">
          <Label htmlFor="password" className="block">
            Password
          </Label>
          <p className="mt-1 font-sans text-xs text-[var(--color-landing-text-muted)]">
            Tipea una password o genera una automatica de 8 caracteres
            (4 letras + 4 numeros). Es la unica vez que se va a poder ver
            en plain.
          </p>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                {...form.register("password")}
                className="pr-12 font-mono"
              />
              <button
                type="button"
                aria-label={showPassword ? "Ocultar" : "Mostrar"}
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
            <Button
              type="button"
              variant="outlined"
              size="sm"
              onClick={handleGeneratePassword}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              Generar
            </Button>
          </div>
          {form.formState.errors.password ? (
            <p className="mt-2 font-sans text-xs text-[var(--color-landing-red)]">
              {form.formState.errors.password.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:justify-end">
          <Button
            type="button"
            variant="outlined"
            onClick={() => router.push("/admin/usuarios")}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? "Creando..." : "Crear usuario"}
          </Button>
        </div>
      </form>

      <PasswordSuccessDialog
        password={createdPassword}
        onClose={closeAndRedirect}
      />
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="block">{label}</Label>
      {children}
      {error ? (
        <p className="font-sans text-xs text-[var(--color-landing-red)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PasswordSuccessDialog({
  password,
  onClose,
}: {
  password: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!password) return;
    const ok = await copyToClipboard(password);
    if (ok) {
      setCopied(true);
      toast.success("Password copiada al portapapeles");
    } else {
      toast.error("No se pudo copiar — copia manualmente");
    }
  };

  return (
    <Dialog
      open={password !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Usuario creado</DialogTitle>
          <DialogDescription>
            Pasale esta password al usuario por WhatsApp. No te la podemos
            mostrar de nuevo.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 rounded-sm border-2 border-[var(--color-landing-text)] bg-[var(--color-landing-surface)] p-6 text-center">
          <p
            className="font-[family-name:var(--font-landing-display)] tracking-tight text-[var(--color-landing-text)]"
            style={{ fontSize: "32px", letterSpacing: "0.1em" }}
          >
            {password}
          </p>
        </div>
        <Button
          type="button"
          variant="outlined"
          onClick={handleCopy}
          className={cn(copied && "border-[var(--color-landing-text)]")}
        >
          <Copy className="mr-2 h-4 w-4" aria-hidden />
          {copied ? "Copiada" : "Copiar al portapapeles"}
        </Button>
        <DialogFooter>
          <Button type="button" variant="primary" onClick={onClose}>
            Listo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

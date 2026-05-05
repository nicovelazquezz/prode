"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Share2, Trophy } from "lucide-react";
import Link from "next/link";
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
import { createLeague } from "@/lib/api/leagues";
import { queryKeys } from "@/lib/api/queryKeys";
import type { League } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

const FRONTEND_URL =
  process.env.NEXT_PUBLIC_FRONTEND_URL ?? "http://localhost:3000";

const schema = z.object({
  name: z
    .string()
    .min(3, "Minimo 3 caracteres")
    .max(50, "Maximo 50 caracteres"),
  description: z
    .string()
    .max(200, "Maximo 200 caracteres")
    .optional()
    .or(z.literal("")),
  isPublic: z.boolean(),
  maxMembers: z
    .number({ message: "Numero invalido" })
    .int()
    .min(2, "Minimo 2")
    .max(200, "Maximo 200"),
});

type FormValues = z.infer<typeof schema>;

export default function CrearLigaPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [created, setCreated] = useState<League | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      description: "",
      isPublic: false,
      maxMembers: 50,
    },
  });

  const createMutation = useMutation({
    mutationFn: (dto: {
      name: string;
      description?: string;
      isPublic?: boolean;
      maxMembers?: number;
    }) => createLeague(dto),
    onSuccess: (league) => {
      qc.invalidateQueries({ queryKey: queryKeys.leagues.all() });
      setCreated(league);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos crear la liga.");
    },
  });

  const onSubmit = (values: FormValues) => {
    createMutation.mutate({
      name: values.name,
      description: values.description?.trim()
        ? values.description.trim()
        : undefined,
      isPublic: values.isPublic,
      maxMembers: values.maxMembers,
    });
  };

  return (
    <section className="mx-auto max-w-xl px-4 py-6 md:px-8">
      <Link
        href="/ligas"
        className="inline-flex items-center gap-2 mb-3 font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)]"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Volver
      </Link>

      <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide leading-none text-[var(--color-prode-near-black)]">
        Crear mini-liga
      </h1>
      <p className="mt-2 font-sans text-sm text-[var(--color-prode-text-secondary)]">
        Compartis un codigo con tus amigos y se suman.
      </p>

      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mt-8 flex flex-col gap-6"
        noValidate
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            type="text"
            autoComplete="off"
            placeholder="Los Pibes del Barrio"
            aria-invalid={form.formState.errors.name ? "true" : "false"}
            {...form.register("name")}
          />
          {form.formState.errors.name ? (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Descripcion (opcional)</Label>
          <Input
            id="description"
            type="text"
            autoComplete="off"
            placeholder="Mini-liga de la oficina"
            aria-invalid={form.formState.errors.description ? "true" : "false"}
            {...form.register("description")}
          />
          {form.formState.errors.description ? (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {form.formState.errors.description.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="maxMembers">Cantidad maxima de miembros</Label>
          <Input
            id="maxMembers"
            type="number"
            inputMode="numeric"
            min={2}
            max={200}
            aria-invalid={form.formState.errors.maxMembers ? "true" : "false"}
            {...form.register("maxMembers", { valueAsNumber: true })}
          />
          {form.formState.errors.maxMembers ? (
            <p className="font-sans text-xs text-[var(--color-prode-accent)]">
              {form.formState.errors.maxMembers.message}
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
            {...form.register("isPublic")}
          />
          <div className="min-w-0">
            <p className="font-sans text-sm font-medium text-[var(--color-prode-near-black)]">
              Liga publica
            </p>
            <p className="font-sans text-xs text-[var(--color-prode-text-secondary)]">
              Cualquiera con el codigo puede unirse. Las privadas requieren aprobacion del owner (proximamente).
            </p>
          </div>
        </label>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={createMutation.isPending}
          className="w-full justify-center"
        >
          {createMutation.isPending ? "Creando..." : "Crear liga"}
        </Button>
      </form>

      <CreatedDialog
        league={created}
        onClose={() => setCreated(null)}
        onGoToLeaderboard={() => {
          if (created) router.push(`/leaderboard/liga/${created.id}`);
          setCreated(null);
        }}
      />
    </section>
  );
}

function CreatedDialog({
  league,
  onClose,
  onGoToLeaderboard,
}: {
  league: League | null;
  onClose: () => void;
  onGoToLeaderboard: () => void;
}) {
  const open = league !== null;
  const code = league?.inviteCode ?? "";

  const waText = league
    ? `Te invito a mi mini-liga del Prode con codigo ${code}: ${FRONTEND_URL}/ligas/unirme?code=${code}`
    : "";
  const waHref = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Liga creada</DialogTitle>
          <DialogDescription>
            Pasale este codigo a tus amigos para que se unan.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 text-center">
          <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Codigo de invitacion
          </p>
          <p
            className="mt-2 font-display font-black uppercase tracking-tight tabular-nums leading-none text-[var(--color-prode-near-black)]"
            style={{ fontSize: "clamp(48px, 14vw, 80px)" }}
          >
            {code}
          </p>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-stretch">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center justify-center gap-2 flex-1",
              "rounded-md bg-[var(--color-prode-accent)] px-6 h-12",
              "font-sans text-sm font-bold uppercase tracking-wider text-white",
              "transition-opacity duration-200 hover:opacity-90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-offset-2",
            )}
          >
            <Share2 className="h-4 w-4" aria-hidden />
            Compartir por WhatsApp
          </a>
          <Button
            type="button"
            variant="outlined"
            className="flex-1 gap-2"
            onClick={onGoToLeaderboard}
          >
            <Trophy className="h-4 w-4" aria-hidden />
            Ver tabla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

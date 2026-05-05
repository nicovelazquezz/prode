"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Send } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AdminDataTable } from "@/components/domain/admin-data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import {
  broadcastNotification,
  listNotificationHistory,
  sendDirectNotification,
  type NotificationHistoryEntry,
  type NotificationSegment,
} from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/queryKeys";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

type TabValue = "direct" | "broadcast" | "templates" | "history";

const TEMPLATES: Array<{
  key: string;
  title: string;
  body: string;
  description: string;
}> = [
  {
    key: "PAYMENT_REMINDER",
    title: "Recordatorio de pago",
    body: "Hola {{nombre}}, te quedan unas horas para completar la inscripcion al Prode. Si necesitas ayuda escribi por aca.",
    description: "Para users con registro pendiente.",
  },
  {
    key: "WELCOME",
    title: "Bienvenida",
    body: "Bienvenido al Prode! Tu password es {{password}}. Cargas tus predicciones aca: {{url}}",
    description: "Despues de pago confirmado.",
  },
  {
    key: "MATCH_REMINDER",
    title: "Recordatorio de partido",
    body: "Faltan 24h para {{partido}}. Cargaste tu prediccion?",
    description: "Auto-enviada 24h antes del kickoff.",
  },
  {
    key: "PHASE_RESULT",
    title: "Resultado de fase",
    body: "Termino la fase {{fase}}. Tu posicion: {{posicion}} con {{puntos}} pts.",
    description: "Despues del cierre de fase.",
  },
  {
    key: "PASSWORD_RESET",
    title: "Reset de password",
    body: "Tu nueva password temporal es {{password}}. Cambiala al ingresar.",
    description: "Manual desde /admin/usuarios.",
  },
];

/**
 * /admin/notificaciones — 4 tabs (Mensajes, Broadcast, Plantillas,
 * Historial). Mensajes y Broadcast son forms simples; Plantillas son
 * read-only por ahora; Historial es tabla paginada.
 *
 * Mobile responsive: tabs siempre visibles, forms 1 col, tabla con
 * scroll horizontal.
 */
export default function AdminNotificacionesPage() {
  const [tab, setTab] = useState<TabValue>("direct");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          Notificaciones
        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-prode-text-secondary)]">
          Envia mensajes 1-a-1 o broadcast por segmento, revisa el historial.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList className="w-full">
          <TabsTrigger value="direct" className="flex-1">
            Mensajes
          </TabsTrigger>
          <TabsTrigger value="broadcast" className="flex-1">
            Broadcast
          </TabsTrigger>
          <TabsTrigger value="templates" className="flex-1">
            Plantillas
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1">
            Historial
          </TabsTrigger>
        </TabsList>

        <TabsContent value="direct" className="mt-6">
          <DirectMessageForm />
        </TabsContent>
        <TabsContent value="broadcast" className="mt-6">
          <BroadcastForm />
        </TabsContent>
        <TabsContent value="templates" className="mt-6">
          <TemplatesList />
        </TabsContent>
        <TabsContent value="history" className="mt-6">
          <HistoryTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DirectMessageForm() {
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");

  const sendMutation = useMutation({
    mutationFn: () =>
      sendDirectNotification({
        userId: userId.trim(),
        title: title.trim(),
        message: message.trim(),
        channel,
      }),
    onSuccess: () => {
      toast.success("Mensaje enviado");
      setUserId("");
      setTitle("");
      setMessage("");
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos enviar el mensaje.");
    },
  });

  const canSend = userId.trim() && title.trim() && message.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) sendMutation.mutate();
      }}
      className="space-y-4 rounded-md border border-[var(--color-prode-border)] bg-white p-5 md:p-6"
      noValidate
    >
      <div>
        <Label htmlFor="userId">User ID</Label>
        <Input
          id="userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Pegar el ID del user (de /admin/usuarios)"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_180px]">
        <div>
          <Label htmlFor="title">Titulo</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="channel">Canal</Label>
          <select
            id="channel"
            value={channel}
            onChange={(e) =>
              setChannel(e.target.value as "WHATSAPP" | "EMAIL")
            }
            className="h-12 w-full rounded-md border border-[var(--color-prode-border)] bg-white px-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-prode-near-black)] focus:ring-offset-2"
          >
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">Email</option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="message">Mensaje</Label>
        <textarea
          id="message"
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-md border border-[var(--color-prode-border)] bg-white px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-prode-near-black)] focus:ring-offset-2"
        />
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          disabled={!canSend || sendMutation.isPending}
        >
          <Send className="mr-2 h-4 w-4" aria-hidden />
          {sendMutation.isPending ? "Enviando..." : "Enviar"}
        </Button>
      </div>
    </form>
  );
}

function BroadcastForm() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [segment, setSegment] = useState<NotificationSegment>("ALL");
  const [confirm, setConfirm] = useState(false);

  const broadcastMutation = useMutation({
    mutationFn: () =>
      broadcastNotification({
        title: title.trim(),
        message: message.trim(),
        channel,
        segment,
      }),
    onSuccess: (res) => {
      toast.success(`Broadcast en cola: ${res.queued} mensajes`);
      setTitle("");
      setMessage("");
      setConfirm(false);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos disparar el broadcast.");
    },
  });

  const canSend = title.trim() && message.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm) {
          setConfirm(true);
          return;
        }
        if (canSend) broadcastMutation.mutate();
      }}
      className="space-y-4 rounded-md border border-[var(--color-prode-border)] bg-white p-5 md:p-6"
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="bc-channel">Canal</Label>
          <select
            id="bc-channel"
            value={channel}
            onChange={(e) =>
              setChannel(e.target.value as "WHATSAPP" | "EMAIL")
            }
            className="h-12 w-full rounded-md border border-[var(--color-prode-border)] bg-white px-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-prode-near-black)] focus:ring-offset-2"
          >
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">Email</option>
          </select>
        </div>
        <div>
          <Label htmlFor="segment">Segmento</Label>
          <select
            id="segment"
            value={segment}
            onChange={(e) =>
              setSegment(e.target.value as NotificationSegment)
            }
            className="h-12 w-full rounded-md border border-[var(--color-prode-border)] bg-white px-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-prode-near-black)] focus:ring-offset-2"
          >
            <option value="ALL">Todos</option>
            <option value="PAID">Solo pagos confirmados</option>
            <option value="PENDING">Solo registros pendientes</option>
            <option value="WITHOUT_PREDICTIONS">Sin predicciones cargadas</option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="bc-title">Titulo</Label>
        <Input
          id="bc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="bc-message">Mensaje</Label>
        <textarea
          id="bc-message"
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-md border border-[var(--color-prode-border)] bg-white px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-prode-near-black)] focus:ring-offset-2"
        />
      </div>
      {confirm ? (
        <div
          role="alert"
          className="rounded-md border-2 border-[var(--color-prode-accent)] bg-[var(--color-prode-surface)] p-3"
        >
          <p className="font-sans text-sm font-bold text-[var(--color-prode-accent)]">
            Confirmas el envio masivo? Una vez disparado no se puede revertir.
          </p>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        {confirm ? (
          <Button
            type="button"
            variant="outlined"
            onClick={() => setConfirm(false)}
          >
            Cancelar
          </Button>
        ) : null}
        <Button
          type="submit"
          variant={confirm ? "destructive" : "primary"}
          disabled={!canSend || broadcastMutation.isPending}
        >
          {broadcastMutation.isPending
            ? "Encolando..."
            : confirm
              ? "CONFIRMAR BROADCAST"
              : "Enviar"}
        </Button>
      </div>
    </form>
  );
}

function TemplatesList() {
  return (
    <div className="space-y-3">
      <p className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
        Plantillas pre-definidas (read-only por ahora). En el futuro se podra
        editar el contenido y los placeholders desde aca.
      </p>
      <ul className="space-y-2">
        {TEMPLATES.map((t) => (
          <li
            key={t.key}
            className="rounded-md border border-[var(--color-prode-border)] bg-white p-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-base font-black uppercase tracking-wide">
                {t.title}
              </h3>
              <span className="font-mono text-xs text-[var(--color-prode-text-secondary)]">
                {t.key}
              </span>
            </div>
            <p className="mt-1 font-sans text-xs text-[var(--color-prode-text-secondary)]">
              {t.description}
            </p>
            <pre className="mt-3 whitespace-pre-wrap rounded-md bg-[var(--color-prode-surface)] p-3 font-mono text-xs text-[var(--color-prode-near-black)]">
              {t.body}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryTable() {
  const [page, setPage] = useState(1);

  const filters = useMemo(() => ({ page, pageSize: 50 }), [page]);
  const historyQuery = useQuery({
    queryKey: queryKeys.admin.notifications.history(filters),
    queryFn: () => listNotificationHistory(filters),
    placeholderData: (prev) => prev,
    retry: false,
  });

  const columns = useMemo<ColumnDef<NotificationHistoryEntry, unknown>[]>(
    () => [
      {
        header: "Fecha",
        cell: ({ row }) => (
          <span className="font-sans text-xs">
            {formatDateTime(row.original.sentAt ?? row.original.createdAt)}
          </span>
        ),
      },
      {
        header: "Destinatario",
        cell: ({ row }) => row.original.recipientLabel ?? "—",
      },
      {
        header: "Canal",
        cell: ({ row }) => (
          <span className="font-mono text-xs uppercase">
            {row.original.channel}
          </span>
        ),
      },
      {
        header: "Titulo",
        cell: ({ row }) => (
          <span className="line-clamp-1">{row.original.title}</span>
        ),
      },
      {
        header: "Estado",
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-block rounded-pill px-2 py-1 font-sans text-[10px] font-bold uppercase tracking-wider",
              row.original.status === "DELIVERED" ||
                row.original.status === "SENT"
                ? "bg-[var(--color-prode-near-black)] text-white"
                : row.original.status === "FAILED"
                  ? "bg-[var(--color-prode-accent)] text-white"
                  : "bg-[var(--color-prode-surface)] text-[var(--color-prode-text-secondary)]",
            )}
          >
            {row.original.status}
          </span>
        ),
      },
    ],
    [],
  );

  const total = historyQuery.data?.total ?? 0;
  const pageSize = historyQuery.data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  return (
    <div className="space-y-4">
      <AdminDataTable
        data={historyQuery.data?.data ?? []}
        columns={columns}
        loading={historyQuery.isLoading}
        emptyMessage="Sin notificaciones registradas todavia."
        ariaLabel="Tabla de historial"
      />
      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-[var(--color-prode-border)] bg-white px-4 py-2 font-sans text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-[var(--color-prode-surface)]"
          >
            Anterior
          </button>
          <span className="font-sans text-xs uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Pagina {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-[var(--color-prode-border)] bg-white px-4 py-2 font-sans text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-[var(--color-prode-surface)]"
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}

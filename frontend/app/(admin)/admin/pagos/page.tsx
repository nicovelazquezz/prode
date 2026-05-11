"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { HTTPError } from "ky";
import { CheckCircle2, MessageCircle, Plus, Search, X } from "lucide-react";
import { AdminDataTable } from "@/components/domain/admin-data-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SideDrawer,
  SideDrawerContent,
  SideDrawerHeader,
  SideDrawerTitle,
  SideDrawerDescription,
  SideDrawerBody,
  SideDrawerFooter,
} from "@/components/ui/side-drawer";
import { toast } from "@/components/ui/toaster";
import {
  annulEntry,
  approvePayment,
  createManualPayment,
  listPayments,
  listUsers,
  sendDirectNotification,
  type AdminPayment,
  type AdminUser,
} from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/queryKeys";
import { formatARS, formatDateTime, formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { PaymentMethod, PaymentStatus } from "@/lib/api/types";

type StatusFilter = "ALL" | PaymentStatus;
type MethodFilter = "ALL" | PaymentMethod;

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "APPROVED", label: "Aprobados" },
  { value: "PENDING", label: "Pendientes" },
  { value: "REJECTED", label: "Rechazados" },
  { value: "REFUNDED", label: "Reembolsados" },
  { value: "ORPHANED", label: "Huerfanos" },
];

const METHOD_OPTIONS: Array<{ value: MethodFilter; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "MERCADOPAGO", label: "MercadoPago" },
  { value: "CASH", label: "Efectivo" },
  { value: "TRANSFER", label: "Transferencia" },
];

/**
 * Lista de pagos admin (spec §6.11). Fila clickeable que abre un
 * SideDrawer con detalle completo (incluye `mpRawData` JSON formateado).
 * Boton "Marcar manual como aprobado" (ultimo recurso) con confirmacion.
 *
 * Mobile: filtros stacked, tabla con scroll horizontal, drawer ocupa
 * todo el ancho.
 */
export default function AdminPagosPage() {
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [method, setMethod] = useState<MethodFilter>("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminPayment | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [annulTarget, setAnnulTarget] = useState<AdminPayment | null>(null);

  const filters = useMemo(
    () => ({
      page,
      pageSize: 50,
      status: status === "ALL" ? undefined : status,
      method: method === "ALL" ? undefined : method,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
    [page, status, method, fromDate, toDate],
  );

  const paymentsQuery = useQuery({
    queryKey: queryKeys.admin.payments.list(filters),
    queryFn: () => listPayments(filters),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<AdminPayment, unknown>[]>(
    () => [
      {
        header: "Usuario",
        cell: ({ row }) => {
          const u = row.original.user;
          return (
            <div className="flex flex-col">
              <span className="font-medium">
                {u ? `${u.firstName} ${u.lastName}` : row.original.payerName ?? "—"}
              </span>
              <span className="font-mono text-xs text-[var(--color-landing-text-muted)]">
                {u?.dni ?? "Sin DNI"}
              </span>
            </div>
          );
        },
      },
      {
        header: "Monto",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums font-bold">
            {formatARS(row.original.amount)}
          </span>
        ),
      },
      {
        header: "Metodo",
        cell: ({ row }) => (
          <span className="font-sans text-xs uppercase tracking-wider text-[var(--color-landing-text-muted)]">
            {row.original.method}
          </span>
        ),
      },
      {
        header: "Estado",
        cell: ({ row }) => <PaymentStatusBadge status={row.original.status} />,
      },
      {
        header: "Fecha",
        cell: ({ row }) => (
          <span className="font-sans text-xs">
            {formatDateTime(
              row.original.completedAt ?? row.original.createdAt,
            )}
          </span>
        ),
      },
      {
        header: "ID MP",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-[var(--color-landing-text-muted)]">
            {row.original.mpPaymentId ?? "—"}
          </span>
        ),
      },
      {
        header: "Acción",
        cell: ({ row }) => {
          const p = row.original;
          // "Anular" solo visible si el payment está APPROVED y tiene
          // un Entry ACTIVE. Si está REFUNDED, ya fue anulado.
          if (
            p.status !== "APPROVED" ||
            !p.entry ||
            p.entry.status !== "ACTIVE"
          ) {
            return (
              <span className="font-mono text-xs text-[var(--color-landing-text-muted)]">
                —
              </span>
            );
          }
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAnnulTarget(p);
              }}
              className="font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-landing-red)] underline underline-offset-4 decoration-[var(--color-landing-red)] hover:text-[var(--color-landing-text)] hover:decoration-[var(--color-landing-text)] transition-colors"
            >
              Anular
            </button>
          );
        },
      },
    ],
    [],
  );

  const total = paymentsQuery.data?.total ?? 0;
  const pageSize = paymentsQuery.data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
            Recaudación
          </div>
          <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
              Pagos
            </span>
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="inline-flex items-center gap-2 rounded-sm bg-[var(--color-landing-red)] px-5 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] self-start md:self-end"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Pago manual
        </button>
      </header>
      <p className="font-sans text-sm text-[var(--color-landing-text-muted)]">
        {formatNumber(total)} resultados · click en una fila para ver detalle
      </p>

      <AdminDataTable
        data={paymentsQuery.data?.data ?? []}
        columns={columns}
        loading={paymentsQuery.isLoading}
        emptyMessage="Sin pagos para los filtros aplicados."
        ariaLabel="Tabla de pagos"
        onRowClick={setSelected}
        toolbar={
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <select
              aria-label="Filtrar por estado"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as StatusFilter);
                setPage(1);
              }}
              className="h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-landing-gold)] focus:ring-offset-2"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por metodo"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as MethodFilter);
                setPage(1);
              }}
              className="h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-landing-gold)] focus:ring-offset-2"
            >
              {METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              aria-label="Desde"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              aria-label="Hasta"
            />
          </div>
        }
      />

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
          >
            Anterior
          </button>
          <span className="font-sans text-xs uppercase tracking-wider text-[var(--color-landing-text-muted)]">
            Pagina {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
          >
            Siguiente
          </button>
        </div>
      ) : null}

      <PaymentDetailDrawer
        payment={selected}
        onClose={() => setSelected(null)}
      />

      <ManualPaymentModal
        open={manualOpen}
        onOpenChange={setManualOpen}
      />

      <AnnulEntryDialog
        target={annulTarget}
        onClose={() => setAnnulTarget(null)}
      />
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const styles: Record<PaymentStatus, string> = {
    APPROVED: "bg-[var(--color-landing-green)] text-[var(--color-landing-text)]",
    PENDING:
      "bg-[var(--color-landing-surface)] text-[var(--color-landing-text-muted)]",
    REJECTED: "bg-[var(--color-landing-red)] text-[var(--color-landing-text)]",
    REFUNDED:
      "bg-[var(--color-landing-surface)] text-[var(--color-landing-text-muted)]",
    OVER_CAP: "bg-[var(--color-landing-red)] text-[var(--color-landing-text)]",
    ORPHANED: "bg-[var(--color-landing-red)] text-[var(--color-landing-text)]",
  };
  return (
    <span
      className={cn(
        "inline-block rounded-sm px-2 py-1 font-sans text-xs font-bold uppercase tracking-wider",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}

function PaymentDetailDrawer({
  payment,
  onClose,
}: {
  payment: AdminPayment | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudgeMessage, setNudgeMessage] = useState("");

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvePayment(id),
    onSuccess: () => {
      toast.success("Pago marcado como aprobado");
      qc.invalidateQueries({ queryKey: queryKeys.admin.payments.list() });
      setConfirmOpen(false);
      onClose();
    },
    onError: (err: Error) => {
      toast.error(
        err.message ??
          "No pudimos aprobar el pago. Verifica que el endpoint exista.",
      );
    },
  });

  // D1 — "Avisar por WhatsApp" cuando el pago está PENDING/ORPHANED y hay
  // un user asociado (típicamente: pago iniciado por public registration
  // que nunca completó). Manda un WA pre-armado con el link de
  // completar-registro o un mensaje custom que el admin puede editar.
  const nudgeMutation = useMutation({
    mutationFn: (msg: string) => {
      if (!payment?.user) {
        return Promise.reject(new Error("Pago sin user asociado"));
      }
      return sendDirectNotification({
        userId: payment.user.id,
        title: "Tu pago de Prode Plus",
        message: msg,
        channel: "WHATSAPP",
      });
    },
    onSuccess: () => {
      toast.success("WhatsApp encolado para enviar");
      setNudgeOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos encolar el WhatsApp.");
    },
  });

  const canNudge =
    !!payment?.user &&
    (payment?.status === "PENDING" || payment?.status === "ORPHANED");

  const open = payment !== null;

  return (
    <SideDrawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SideDrawerContent>
        {payment ? (
          <>
            <SideDrawerHeader>
              <SideDrawerTitle>Detalle del pago</SideDrawerTitle>
              <SideDrawerDescription>
                ID interno: <span className="font-mono">{payment.id}</span>
              </SideDrawerDescription>
            </SideDrawerHeader>
            <SideDrawerBody>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <DetailRow label="Estado">
                  <PaymentStatusBadge status={payment.status} />
                </DetailRow>
                <DetailRow label="Metodo">{payment.method}</DetailRow>
                <DetailRow label="Monto">
                  <span className="font-mono font-bold">
                    {formatARS(payment.amount)}
                  </span>
                </DetailRow>
                <DetailRow label="ID MP">
                  <span className="font-mono">
                    {payment.mpPaymentId ?? "—"}
                  </span>
                </DetailRow>
                <DetailRow label="Pagador">
                  {payment.user
                    ? `${payment.user.firstName} ${payment.user.lastName}`
                    : payment.payerName ?? "—"}
                </DetailRow>
                <DetailRow label="Email">{payment.payerEmail ?? "—"}</DetailRow>
                <DetailRow label="DNI">
                  <span className="font-mono">{payment.user?.dni ?? "—"}</span>
                </DetailRow>
                <DetailRow label="Creado">
                  {formatDateTime(payment.createdAt)}
                </DetailRow>
                <DetailRow label="Completado">
                  {formatDateTime(payment.completedAt)}
                </DetailRow>
              </dl>

              <div className="mt-6">
                <h3 className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
                  mpRawData
                </h3>
                <pre className="mt-2 max-h-64 overflow-auto rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-3 font-mono text-xs text-[var(--color-landing-text)]">
                  {payment.mpRawData
                    ? JSON.stringify(payment.mpRawData, null, 2)
                    : "// No hay payload MP almacenado para este pago."}
                </pre>
              </div>
            </SideDrawerBody>
            <SideDrawerFooter>
              {canNudge ? (
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => {
                    setNudgeMessage(
                      `Hola ${payment.user?.firstName ?? ""}! Vimos que tu pago de Prode Plus quedó pendiente. Si necesitás ayuda, respondé este mensaje. Si querés intentar de nuevo, podés iniciar un nuevo pago desde prodeplus.com`.trim(),
                    );
                    setNudgeOpen(true);
                  }}
                  disabled={nudgeMutation.isPending}
                >
                  <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
                  Avisar por WhatsApp
                </Button>
              ) : null}
              {payment.status !== "APPROVED" ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setConfirmOpen(true)}
                  disabled={approveMutation.isPending}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
                  Marcar como aprobado
                </Button>
              ) : null}
            </SideDrawerFooter>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirmas?</DialogTitle>
                  <DialogDescription>
                    Esta accion marca manualmente el pago como APPROVED y
                    queda registrada en auditoria. Solo usar como ultimo
                    recurso si MP no replico.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outlined"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => approveMutation.mutate(payment.id)}
                    disabled={approveMutation.isPending}
                  >
                    {approveMutation.isPending
                      ? "Aprobando..."
                      : "Confirmar aprobacion"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={nudgeOpen} onOpenChange={setNudgeOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Avisar por WhatsApp</DialogTitle>
                  <DialogDescription>
                    Editá el mensaje y mandá. Se encola en la cola de
                    WhatsApp del sistema; si el gateway está caído, se
                    reintenta automáticamente cuando vuelve.
                  </DialogDescription>
                </DialogHeader>
                <textarea
                  className="mt-2 h-32 w-full resize-none rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] p-3 font-sans text-sm text-[var(--color-landing-text)] focus:outline focus:outline-2 focus:outline-[var(--color-landing-gold)]"
                  value={nudgeMessage}
                  onChange={(e) => setNudgeMessage(e.target.value)}
                  maxLength={2000}
                  aria-label="Mensaje a enviar"
                />
                <p className="mt-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
                  {nudgeMessage.length} / 2000
                </p>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outlined"
                    onClick={() => setNudgeOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => nudgeMutation.mutate(nudgeMessage)}
                    disabled={
                      nudgeMutation.isPending || nudgeMessage.trim().length < 1
                    }
                  >
                    {nudgeMutation.isPending ? "Enviando..." : "Enviar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </SideDrawerContent>
    </SideDrawer>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-landing-text-muted)]">
        {label}
      </dt>
      <dd className="font-sans text-sm text-[var(--color-landing-text)]">
        {children}
      </dd>
    </>
  );
}

/**
 * Modal "Confirmar pago manual" — path A del flow operacional. El user
 * pagó por fuera del sistema (transferencia o efectivo) y avisó por
 * WhatsApp; el admin lo registra acá. Crea Payment + Entry adicional
 * vía POST /admin/payments/manual.
 *
 * UX:
 *   1. User picker: input con search debounceada por DNI/nombre/whatsapp,
 *      muestra hasta 8 resultados. Al seleccionar, queda fijo arriba con
 *      botón "cambiar".
 *   2. Radio CASH / TRANSFER (default: TRANSFER, lo más común).
 *   3. Notas: textarea opcional (max 500 chars) — referencia bancaria,
 *      "pagó en mano el sábado", etc.
 *   4. Submit: mutation con manejo de errores tipados:
 *      - 404: usuario no existe (raro, pasó algo entre la search y el submit)
 *      - 403: usuario no ACTIVE
 *      - 409 ENTRY_CAP_REACHED: cap alcanzado, sugiere subir cap en config
 *      - 409 REGISTRATION_CLOSED: pasó la fecha de cierre
 */
function ManualPaymentModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [method, setMethod] = useState<"CASH" | "TRANSFER">("TRANSFER");
  const [notes, setNotes] = useState("");

  // Reset al abrir/cerrar.
  useEffect(() => {
    if (!open) {
      setSelectedUser(null);
      setMethod("TRANSFER");
      setNotes("");
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!selectedUser) throw new Error("No user selected");
      return createManualPayment({
        userId: selectedUser.id,
        method,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: (data) => {
      // Invalidar payments + entries + metrics para que el dashboard y
      // la lista reflejen el nuevo pago al instante.
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.payments.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.metrics() });
      queryClient.invalidateQueries({ queryKey: ["admin", "entries"] });
      toast.success(
        `Pago registrado · prode #${data.entry.position} creado para ${selectedUser?.firstName} ${selectedUser?.lastName}`,
      );
      onOpenChange(false);
    },
    onError: async (err: Error) => {
      let message = "No pudimos registrar el pago.";
      if (err instanceof HTTPError) {
        try {
          const body = (await err.response.clone().json()) as {
            code?: string;
            message?: string;
            cap?: number;
            current?: number;
          };
          if (body?.code === "ENTRY_CAP_REACHED") {
            message = `El usuario llegó al cap de ${body.cap} prodes (tiene ${body.current}). Subí el cap en /admin/configuracion antes de agregar más.`;
          } else if (body?.code === "REGISTRATION_CLOSED") {
            message =
              "La inscripción está cerrada — no se pueden registrar pagos nuevos.";
          } else if (body?.message) {
            message = body.message;
          }
        } catch {
          // dejamos el message default
        }
      }
      toast.error(message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[3px] border-[var(--color-landing-green)] pb-1">
              Confirmar pago manual
            </span>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            El user pagó por fuera del sistema (transferencia o efectivo) y te
            avisó. Acá registrás el pago y se le crea un nuevo prode automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-5">
          {/* User picker */}
          {selectedUser ? (
            <div className="rounded-sm border border-[var(--color-landing-green)] bg-[var(--color-landing-surface-2)] p-3 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-landing-green)]" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="font-[family-name:var(--font-landing-display)] text-base uppercase tracking-tight text-[var(--color-landing-text)] truncate">
                  {selectedUser.firstName} {selectedUser.lastName}
                </p>
                <p className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
                  DNI {selectedUser.dni} · {selectedUser.whatsapp}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)] transition-colors"
                aria-label="Cambiar usuario"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <UserSearchPicker onPick={setSelectedUser} />
          )}

          {/* Método */}
          <fieldset>
            <legend className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)] mb-2">
              Método de pago
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(["TRANSFER", "CASH"] as const).map((m) => (
                <label
                  key={m}
                  className={cn(
                    "flex cursor-pointer items-center justify-center gap-2 rounded-sm border-2 px-4 py-3 transition-colors",
                    method === m
                      ? "border-[var(--color-landing-gold)] bg-[var(--color-landing-surface-2)]"
                      : "border-[var(--color-landing-line-strong)] bg-transparent hover:border-[var(--color-landing-text)]",
                  )}
                >
                  <input
                    type="radio"
                    name="method"
                    value={m}
                    checked={method === m}
                    onChange={() => setMethod(m)}
                    className="sr-only"
                  />
                  <span className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)]">
                    {m === "CASH" ? "Efectivo" : "Transferencia"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Notas */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="manual-notes"
              className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]"
            >
              Notas (opcional)
            </label>
            <textarea
              id="manual-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Ej: transferencia ID 1234, pagó en mano el sábado..."
              className="w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 py-2 text-sm text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
            />
            <p className="text-right font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
              {notes.length} / 500
            </p>
          </div>
        </div>

        <DialogFooter className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-stretch">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            className="inline-flex flex-1 items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!selectedUser || mutation.isPending}
            className="inline-flex flex-1 items-center justify-center rounded-sm bg-[var(--color-landing-red)] px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending ? "Registrando..." : "Confirmar pago"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * User picker con search debounceada. Muestra hasta 8 resultados
 * filtrados por DNI/nombre/whatsapp. Al click, dispara `onPick` con
 * el user seleccionado.
 */
function UserSearchPicker({ onPick }: { onPick: (user: AdminUser) => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce 250ms para no spamear el endpoint con cada keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users.list({
      search: debouncedQuery,
      role: "USER",
      pageSize: 8,
    }),
    queryFn: () =>
      listUsers({ search: debouncedQuery, role: "USER", pageSize: 8 }),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const users = usersQuery.data?.data ?? [];

  return (
    <div>
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-landing-text-muted)]"
          aria-hidden
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por DNI, nombre o WhatsApp..."
          autoFocus
          className="h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] pl-10 pr-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
        />
      </div>
      {debouncedQuery.length >= 2 ? (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-sm border border-[var(--color-landing-line)]">
          {usersQuery.isLoading ? (
            <p className="p-3 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
              Buscando...
            </p>
          ) : users.length === 0 ? (
            <p className="p-3 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
              Sin resultados.
            </p>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => onPick(u)}
                className="w-full text-left px-3 py-2 border-b border-[var(--color-landing-line)] last:border-b-0 hover:bg-[var(--color-landing-surface-2)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-landing-gold)]"
              >
                <p className="font-[family-name:var(--font-landing-display)] text-sm uppercase tracking-tight text-[var(--color-landing-text)]">
                  {u.firstName} {u.lastName}
                </p>
                <p className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
                  DNI {u.dni} · {u.whatsapp}
                </p>
              </button>
            ))
          )}
        </div>
      ) : (
        <p className="mt-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
          Escribí al menos 2 caracteres para buscar.
        </p>
      )}
    </div>
  );
}

/**
 * Dialog destructivo para anular un Entry. Q6=A: borra todas las
 * predicciones cargadas en ese entry. El Payment asociado pasa a
 * REFUNDED (no se borra para audit).
 *
 * UX defensiva:
 *   - Texto claro de qué se borra (predicciones, special, ligas).
 *   - Input "ANULAR" que el admin tiene que escribir para habilitar
 *     el botón rojo. Evita clicks accidentales.
 *   - Toast post-acción con counts exactos del backend.
 *
 * Cuando se anula:
 *   - Invalidamos payments + entries + metrics + leaderboard para
 *     que el dashboard refleje el cambio. La materialized view del
 *     leaderboard se refresca asincrónicamente — el admin puede usar
 *     el botón "Refrescar leaderboard" del dashboard si necesita
 *     forzar el recálculo.
 */
function AnnulEntryDialog({
  target,
  onClose,
}: {
  target: AdminPayment | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState("");

  // Reset al abrir/cerrar.
  useEffect(() => {
    if (!target) setConfirmText("");
  }, [target]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!target?.entry) throw new Error("No entry to annul");
      return annulEntry(target.entry.id);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.payments.list(),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.metrics() });
      queryClient.invalidateQueries({ queryKey: ["admin", "entries"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard.all() });
      const u = target?.user
        ? `${target.user.firstName} ${target.user.lastName}`
        : "user";
      toast.success(
        `Prode anulado · ${data.deletedPredictions} predicciones borradas de ${u}`,
      );
      onClose();
    },
    onError: () => {
      toast.error("No pudimos anular el prode. Reintenta.");
    },
  });

  const isOpen = target !== null;
  const canConfirm =
    confirmText.trim().toUpperCase() === "ANULAR" && !mutation.isPending;

  if (!target?.entry || !target.user) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[3px] border-[var(--color-landing-red)] pb-1">
              Anular prode
            </span>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            Estás por anular el prode <strong>#{target.entry.position}</strong> de{" "}
            <strong>
              {target.user.firstName} {target.user.lastName}
            </strong>{" "}
            (DNI {target.user.dni}).
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 rounded-sm border border-[var(--color-landing-red)] bg-[rgba(163,61,61,0.08)] p-4 space-y-2">
          <p className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-red)]">
            ⚠ Operación destructiva
          </p>
          <ul className="list-disc list-inside text-sm leading-relaxed text-[var(--color-landing-text)] space-y-1">
            <li>Se borran TODAS las predicciones cargadas en este prode</li>
            <li>Se borra la predicción especial (campeón / goleador / total goles)</li>
            <li>Se quita de las mini-ligas donde estaba inscripto</li>
            <li>El pago pasa a REFUNDED (queda en el historial para audit)</li>
          </ul>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <label
            htmlFor="annul-confirm"
            className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]"
          >
            Escribí <strong className="text-[var(--color-landing-red)]">ANULAR</strong> para confirmar
          </label>
          <input
            id="annul-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            autoFocus
            className="h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 text-base text-[var(--color-landing-text)] placeholder:text-[var(--color-landing-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-red)]"
          />
        </div>

        <DialogFooter className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-stretch">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="inline-flex flex-1 items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!canConfirm}
            className="inline-flex flex-1 items-center justify-center rounded-sm bg-[var(--color-landing-red)] px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending ? "Anulando..." : "Anular prode"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

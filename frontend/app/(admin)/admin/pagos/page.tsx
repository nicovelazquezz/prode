"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { CheckCircle2 } from "lucide-react";
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
  approvePayment,
  listPayments,
  type AdminPayment,
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
              <span className="font-mono text-xs text-[var(--color-prode-text-secondary)]">
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
          <span className="font-sans text-xs uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
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
          <span className="font-mono text-xs text-[var(--color-prode-text-secondary)]">
            {row.original.mpPaymentId ?? "—"}
          </span>
        ),
      },
    ],
    [],
  );

  const total = paymentsQuery.data?.total ?? 0;
  const pageSize = paymentsQuery.data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          Pagos
        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-prode-text-secondary)]">
          {formatNumber(total)} resultados · click en una fila para ver detalle
        </p>
      </header>

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
              className="h-12 w-full rounded-md border border-[var(--color-prode-border)] bg-white px-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-prode-near-black)] focus:ring-offset-2"
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
              className="h-12 w-full rounded-md border border-[var(--color-prode-border)] bg-white px-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-prode-near-black)] focus:ring-offset-2"
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

      <PaymentDetailDrawer
        payment={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const styles: Record<PaymentStatus, string> = {
    APPROVED: "bg-[var(--color-prode-near-black)] text-white",
    PENDING:
      "bg-[var(--color-prode-surface)] text-[var(--color-prode-text-secondary)]",
    REJECTED: "bg-[var(--color-prode-accent)] text-white",
    REFUNDED:
      "bg-[var(--color-prode-surface)] text-[var(--color-prode-text-secondary)]",
    ORPHANED: "bg-[var(--color-prode-accent)] text-white",
  };
  return (
    <span
      className={cn(
        "inline-block rounded-pill px-2 py-1 font-sans text-xs font-bold uppercase tracking-wider",
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
                <h3 className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
                  mpRawData
                </h3>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] p-3 font-mono text-xs text-[var(--color-prode-near-black)]">
                  {payment.mpRawData
                    ? JSON.stringify(payment.mpRawData, null, 2)
                    : "// No hay payload MP almacenado para este pago."}
                </pre>
              </div>
            </SideDrawerBody>
            <SideDrawerFooter>
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
      <dt className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
        {label}
      </dt>
      <dd className="font-sans text-sm text-[var(--color-prode-near-black)]">
        {children}
      </dd>
    </>
  );
}

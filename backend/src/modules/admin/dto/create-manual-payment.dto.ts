import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Métodos aceptados por la confirmación manual de pago. MERCADOPAGO
 * intencionalmente excluido — los pagos MP se procesan via webhook
 * (creación automática del Entry) o `POST /admin/payments/:id/approve`
 * (aprobación de un Payment ya creado por el user).
 *
 * Este flow es para el path A del Q1: el user ya existe en el sistema
 * (creó cuenta antes), pagó por fuera del sistema (transferencia o
 * efectivo) y le avisó al admin por WhatsApp. El admin lo registra
 * manualmente y le agrega un Entry más.
 */
export type ManualPaymentMethod = 'CASH' | 'TRANSFER';

const MANUAL_METHODS: ManualPaymentMethod[] = ['CASH', 'TRANSFER'];

export class CreateManualPaymentDto {
  /** ID del User al que se le agrega el pago/prode. */
  @IsString()
  userId!: string;

  /** Cómo pagó: CASH (efectivo) o TRANSFER (transferencia). */
  @IsEnum(MANUAL_METHODS, { message: 'method debe ser CASH o TRANSFER' })
  method!: ManualPaymentMethod;

  /**
   * Nota libre del admin: ej "transferencia ID 1234", "pagó en mano el
   * sábado", "le hicimos descuento del 10% por socio". Aparece en el
   * audit log y en la lista de pagos. Máx 500 chars.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

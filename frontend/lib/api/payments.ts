import { api } from "./client";
import type { Payment } from "./types";

/**
 * Inicia el flujo de pago — `POST /payments/init`. El backend determina
 * el monto desde AppConfig (`inscripcion_precio`), asi que el cliente
 * solo manda el `turnstileToken` (opcional, todavia no usado en dev).
 *
 * Mandar campos extra (`amount`, `payerEmail`) hace que la validacion
 * con `forbidNonWhitelisted` rechace el body con 400.
 */
export async function initPayment(
  dto: { turnstileToken?: string } = {},
): Promise<{ initPoint: string; paymentId: string }> {
  return api
    .post("payments/init", { json: dto })
    .json<{ initPoint: string; paymentId: string }>();
}

export async function getPaymentByToken(token: string): Promise<Payment> {
  return api.get(`payments/by-token/${token}`).json<Payment>();
}

/**
 * Vocabulario que usa el endpoint dev del backend. Espeja el body
 * de POST /dev/simulate-webhook (lowercase MP-style, no nuestro
 * enum domain `PaymentStatus`). Mantenemos los dos vocabularios
 * separados a proposito — el frontend habla MP en el mock checkout
 * y habla el dominio en el resto.
 */
export type SimulateWebhookStatus = "approved" | "rejected" | "pending";

export interface SimulateWebhookResponse {
  ok: true;
  paymentId: string;
  status: SimulateWebhookStatus;
  /**
   * Token plano re-emitido por el backend para usar en el redirect a
   * /completar-registro. El backend solo persiste el hash del token
   * que devolvio en /payments/init (irrecuperable), asi que el dev
   * controller mintea uno nuevo y reemplaza el hash. El frontend
   * usa este `completionToken` para construir el next URL.
   */
  completionToken: string;
}

/**
 * Solo disponible cuando NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT=true (dev).
 * El backend tambien gatea con NODE_ENV !== 'production'.
 */
export async function simulateWebhook(dto: {
  paymentId: string;
  status: SimulateWebhookStatus;
  payerEmail?: string;
}): Promise<SimulateWebhookResponse> {
  return api
    .post("dev/simulate-webhook", { json: dto })
    .json<SimulateWebhookResponse>();
}

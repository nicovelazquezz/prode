import { api } from "./client";
import type { Payment, PaymentStatus } from "./types";

export async function initPayment(dto: {
  amount?: number;
  payerEmail?: string;
}): Promise<{ initPoint: string; paymentId: string }> {
  return api
    .post("payments/init", { json: dto })
    .json<{ initPoint: string; paymentId: string }>();
}

export async function getPaymentByToken(token: string): Promise<Payment> {
  return api.get(`payments/by-token/${token}`).json<Payment>();
}

/**
 * Solo disponible cuando NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT=true (dev).
 * El backend tambien gatea con NODE_ENV !== 'production'.
 */
export async function simulateWebhook(dto: {
  paymentId: string;
  status: PaymentStatus;
  payerEmail?: string;
}): Promise<{ ok: true; paymentId: string; status: PaymentStatus }> {
  return api
    .post("dev/simulate-webhook", { json: dto })
    .json<{ ok: true; paymentId: string; status: PaymentStatus }>();
}

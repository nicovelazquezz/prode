import { Injectable, NotFoundException } from '@nestjs/common';
import { loadEnv } from '../../config/env.js';
import type { CheckoutProvider } from './checkout.provider.js';
import type {
  CreatePreferenceParams,
  CreatePreferenceResult,
  ProviderPayment,
  ProviderPaymentStatus,
  VerifyWebhookSignatureParams,
} from './checkout.types.js';

/**
 * Internal record kept by the mock so each preference can later be
 * resolved to a payment via `simulatePayment`. Mirrors only the fields
 * the webhook handler reads; nothing here is sent to a real network.
 */
interface MockPreferenceRecord {
  preferenceId: string;
  paymentId: string;
  amount: number;
  completionTokenPlain: string;
}

interface MockPaymentRecord {
  id: string;
  preferenceId: string;
  status: ProviderPaymentStatus;
  payerEmail: string | null;
  payerName: string | null;
  completionTokenPlain: string;
  paymentId: string;
}

export interface SimulatePaymentArgs {
  preferenceId: string;
  status: ProviderPaymentStatus;
  payerEmail?: string | null;
  payerName?: string | null;
}

/**
 * In-memory implementation of `CheckoutProvider` used by E2E tests. Replaces
 * the entire MercadoPago round-trip with a deterministic counter:
 *
 *   - `createPreference` mints `mock_pref_${n}` and remembers the inputs.
 *   - `simulatePayment` (test-only helper) materialises a mock payment that
 *     `getPayment` will later resolve, mimicking what MP does between the
 *     user finishing checkout and the webhook firing.
 *   - `verifyWebhookSignature` is a no-op — tests don't exercise HMAC.
 *
 * NOT injected in production; the CheckoutModule binds `CHECKOUT_PROVIDER`
 * to this class only when `NODE_ENV === 'test'`.
 */
@Injectable()
export class MockCheckoutProvider implements CheckoutProvider {
  private prefCounter = 0;
  private paymentCounter = 0;
  private readonly preferences = new Map<string, MockPreferenceRecord>();
  private readonly payments = new Map<string, MockPaymentRecord>();

  async createPreference(
    params: CreatePreferenceParams,
  ): Promise<CreatePreferenceResult> {
    this.prefCounter += 1;
    const preferenceId = `mock_pref_${this.prefCounter}`;
    this.preferences.set(preferenceId, {
      preferenceId,
      paymentId: params.paymentId,
      amount: params.amount,
      completionTokenPlain: params.completionTokenPlain,
    });
    // In NODE_ENV=development the frontend's `/dev/mock-checkout` page
    // takes over for the MP UI. Point initPoint there so the browser
    // redirect from `POST /payments/init` lands on a working page
    // (otherwise it would 404 on the placeholder mock.local host).
    //
    // In NODE_ENV=test, unit tests assert the preferenceId is in the
    // URL path — keep the legacy `https://mock.local/checkout/...`
    // shape so they don't have to know about FRONTEND_URL.
    const initPoint =
      process.env.NODE_ENV === 'development'
        ? `${loadEnv().FRONTEND_URL}/dev/mock-checkout?paymentId=${encodeURIComponent(params.paymentId)}&token=${encodeURIComponent(params.completionTokenPlain)}&preferenceId=${encodeURIComponent(preferenceId)}`
        : `https://mock.local/checkout/${preferenceId}`;
    return { preferenceId, initPoint };
  }

  async getPayment(externalId: string): Promise<ProviderPayment> {
    const payment = this.payments.get(externalId);
    if (!payment) {
      throw new NotFoundException(`Mock payment ${externalId} not found`);
    }
    return {
      id: payment.id,
      preferenceId: payment.preferenceId,
      status: payment.status,
      payer: {
        email: payment.payerEmail,
        firstName: payment.payerName,
      },
      rawData: { id: payment.id, status: payment.status, mock: true },
      metadata: {
        completionToken: payment.completionTokenPlain,
        paymentId: payment.paymentId,
      },
    };
  }

  /**
   * No-op signature check — tests don't exercise HMAC. The production
   * MercadoPago provider does the real verification in its own unit test.
   */
  verifyWebhookSignature(_params: VerifyWebhookSignatureParams): void {
    return;
  }

  /**
   * Test-only helper: simulates the user completing checkout at MP and
   * MP firing a webhook. Returns the synthetic `dataId` (`mock_pay_${n}`)
   * that the test should pass to `POST /payments/webhook` as `body.data.id`.
   *
   * Throws if the preference is unknown so flaky tests fail loud.
   */
  simulatePayment(args: SimulatePaymentArgs): string {
    const pref = this.preferences.get(args.preferenceId);
    if (!pref) {
      throw new NotFoundException(`Mock preference ${args.preferenceId} not found`);
    }
    this.paymentCounter += 1;
    const id = `mock_pay_${this.paymentCounter}`;
    this.payments.set(id, {
      id,
      preferenceId: args.preferenceId,
      status: args.status,
      payerEmail: args.payerEmail ?? null,
      payerName: args.payerName ?? null,
      completionTokenPlain: pref.completionTokenPlain,
      paymentId: pref.paymentId,
    });
    return id;
  }

  /** Test helper: drops in-memory state between tests. */
  reset(): void {
    this.prefCounter = 0;
    this.paymentCounter = 0;
    this.preferences.clear();
    this.payments.clear();
  }
}

import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { loadEnv, type Env } from '../../config/env.js';
import type { CheckoutProvider } from './checkout.provider.js';
import type {
  CreatePreferenceParams,
  CreatePreferenceResult,
  ProviderPayment,
  ProviderPaymentStatus,
  VerifyWebhookSignatureParams,
} from './checkout.types.js';

/**
 * Maps MP's `status` string to our domain enum. Anything unknown collapses
 * to PENDING — we'd rather process the webhook idempotently as no-op than
 * fail-open on an enum we don't understand.
 */
function mapStatus(mpStatus: string | null | undefined): ProviderPaymentStatus {
  switch (mpStatus) {
    case 'approved':
      return 'APPROVED';
    case 'rejected':
    case 'cancelled':
      return 'REJECTED';
    case 'refunded':
    case 'charged_back':
      return 'REFUNDED';
    default:
      return 'PENDING';
  }
}

/**
 * Production `CheckoutProvider` backed by the official `mercadopago` SDK
 * (v2). Wraps three operations:
 *
 *   - `createPreference` — embeds the plain completion token in MP metadata
 *      and `back_urls.success`, excludes Pago Fácil/Rapipago/ATM, single
 *      installment.
 *   - `getPayment` — used by the webhook handler to fetch authoritative
 *     payment state.
 *   - `verifyWebhookSignature` — HMAC-SHA256 over the canonical manifest
 *     `id:${dataId};request-id:${requestId};ts:${ts};` with constant-time
 *     compare. Throws 401 on any mismatch / malformed header.
 */
@Injectable()
export class MercadoPagoCheckoutProvider implements CheckoutProvider {
  private readonly logger = new Logger(MercadoPagoCheckoutProvider.name);
  private readonly env: Env;
  private readonly preference: Preference;
  private readonly payment: Payment;

  constructor() {
    this.env = loadEnv();
    const config = new MercadoPagoConfig({
      accessToken: this.env.MP_ACCESS_TOKEN,
    });
    this.preference = new Preference(config);
    this.payment = new Payment(config);
  }

  async createPreference(
    params: CreatePreferenceParams,
  ): Promise<CreatePreferenceResult> {
    const { paymentId, amount, completionTokenPlain, title } = params;
    const successUrl = `${this.env.FRONTEND_URL}/inscripcion/success?token=${completionTokenPlain}`;
    const failureUrl = `${this.env.FRONTEND_URL}/inscripcion/failure`;
    const pendingUrl = `${this.env.FRONTEND_URL}/inscripcion/pending`;

    const result = await this.preference.create({
      body: {
        items: [
          {
            id: paymentId,
            title: title ?? 'Inscripción Prode Mundial 2026',
            quantity: 1,
            currency_id: 'ARS',
            unit_price: amount,
          },
        ],
        external_reference: paymentId,
        metadata: {
          completion_token: completionTokenPlain,
          payment_id: paymentId,
        },
        back_urls: {
          success: successUrl,
          failure: failureUrl,
          pending: pendingUrl,
        },
        auto_return: 'approved',
        notification_url: `${this.env.API_URL}/payments/webhook`,
        payment_methods: {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }],
          installments: 1,
        },
      },
    });

    if (!result.id || !result.init_point) {
      throw new Error('MercadoPago createPreference returned no id/init_point');
    }
    return { preferenceId: result.id, initPoint: result.init_point };
  }

  async getPayment(externalId: string): Promise<ProviderPayment> {
    // SDK accepts both number and string for `id`; we always have a string
    // coming off the webhook payload.
    const result = await this.payment.get({ id: externalId });
    const meta = (result.metadata ?? {}) as Record<string, unknown>;
    // MP's metadata keys come back snake_case_lower regardless of how we
    // sent them — read both shapes defensively.
    const completionToken =
      (meta.completion_token as string | undefined) ??
      (meta['completionToken'] as string | undefined) ??
      null;
    const internalPaymentId =
      (meta.payment_id as string | undefined) ??
      (meta['paymentId'] as string | undefined) ??
      null;

    // `preference_id` is present in the wire payload but not exposed in
    // the SDK's typed surface; read it through a record cast.
    const raw = result as unknown as Record<string, unknown>;
    const preferenceId =
      typeof raw['preference_id'] === 'string'
        ? (raw['preference_id'] as string)
        : null;

    return {
      id: String(result.id ?? externalId),
      preferenceId,
      status: mapStatus(result.status as string | undefined),
      payer: {
        email: (result.payer?.email as string | undefined) ?? null,
        firstName: (result.payer?.first_name as string | undefined) ?? null,
      },
      rawData: result as unknown as Record<string, unknown>,
      metadata: {
        completionToken,
        paymentId: internalPaymentId,
      },
    };
  }

  /**
   * MP's webhook signature scheme:
   *   - `x-signature` header: `ts=<unix-ts>,v1=<hex>`
   *   - manifest: `id:<dataId>;request-id:<requestId>;ts:<ts>;`
   *   - hash: HMAC-SHA256(manifest) using `MP_WEBHOOK_SECRET`
   *
   * The `ts` is opaque to us — MP supplies it and includes it in the hash;
   * we don't independently validate freshness here (no replay window) since
   * the per-payment idempotency in the handler is the authoritative guard.
   */
  verifyWebhookSignature(params: VerifyWebhookSignatureParams): void {
    const { signatureHeader, requestId, dataId } = params;
    if (!signatureHeader || !requestId || !dataId) {
      throw new UnauthorizedException('Missing webhook signature fields');
    }

    const parts = signatureHeader.split(',').reduce<Record<string, string>>(
      (acc, p) => {
        const [k, ...rest] = p.split('=');
        if (k && rest.length > 0) acc[k.trim()] = rest.join('=').trim();
        return acc;
      },
      {},
    );

    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) {
      throw new UnauthorizedException('Malformed webhook signature header');
    }

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = createHmac('sha256', this.env.MP_WEBHOOK_SECRET)
      .update(manifest)
      .digest('hex');

    let provided: Buffer;
    let computed: Buffer;
    try {
      provided = Buffer.from(v1, 'hex');
      computed = Buffer.from(expected, 'hex');
    } catch {
      throw new UnauthorizedException('Webhook signature is not valid hex');
    }
    if (provided.length !== computed.length) {
      throw new UnauthorizedException('Webhook signature length mismatch');
    }
    if (!timingSafeEqual(provided, computed)) {
      throw new UnauthorizedException('Webhook signature mismatch');
    }
  }
}

import type {
  CreatePreferenceParams,
  CreatePreferenceResult,
  ProviderPayment,
  VerifyWebhookSignatureParams,
} from './checkout.types.js';

/**
 * Provider-agnostic interface for the checkout vendor (currently MercadoPago).
 *
 * The rest of the backend depends only on this contract — the MP SDK is
 * imported exclusively from `mercadopago.provider.ts`, and tests use
 * `mock.provider.ts`. Swapping providers therefore means writing a new
 * implementation and re-binding the `CHECKOUT_PROVIDER` token in the module.
 */
export interface CheckoutProvider {
  /**
   * Creates a payment preference at the provider. Returns the preference id
   * and the user-facing redirect URL (`initPoint`).
   */
  createPreference(params: CreatePreferenceParams): Promise<CreatePreferenceResult>;

  /**
   * Resolves a payment by its provider-side id. Used by the webhook handler
   * to fetch authoritative payment state after receiving a notification.
   * Implementations throw when the id is unknown.
   */
  getPayment(externalId: string): Promise<ProviderPayment>;

  /**
   * Verifies the HMAC signature of an incoming webhook. Throws
   * `UnauthorizedException` (401) on mismatch or malformed header, returns
   * void on success. Implementations MUST use a constant-time compare.
   */
  verifyWebhookSignature(params: VerifyWebhookSignatureParams): void;
}

/**
 * DI token used to inject the active `CheckoutProvider` implementation.
 * The CheckoutModule (Task 5.3+) decides at registration time which concrete
 * class to bind based on `NODE_ENV`.
 */
export const CHECKOUT_PROVIDER = 'CHECKOUT_PROVIDER';

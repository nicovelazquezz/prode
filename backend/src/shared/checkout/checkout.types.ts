/**
 * Provider-agnostic types for the public payment flow.
 *
 * The interface lives next door in `checkout.provider.ts`. These types are
 * shared between the production MercadoPago implementation and the in-memory
 * mock used in tests; the rest of the backend should only depend on these
 * shapes (never the MP SDK directly) so the checkout provider stays swappable.
 */

/** Domain-level mapping of a provider's payment status. */
export type ProviderPaymentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'REFUNDED';

/**
 * Input to `CheckoutProvider.createPreference`. The caller (`PaymentsService`)
 * generates the plain completion token, hashes it, persists the hash, and
 * passes the **plain** token here so the provider can roundtrip it through
 * the preference's metadata and the `back_urls.success` query string. The
 * plain token never lives in our DB.
 */
export interface CreatePreferenceParams {
  /** Our internal Payment.id. Becomes `external_reference` in MP. */
  paymentId: string;
  /** Inscripcion price in ARS. */
  amount: number;
  /** Plain (non-hashed) completion token; embedded in metadata + back_urls. */
  completionTokenPlain: string;
  /** Optional human title shown in MP checkout. */
  title?: string;
}

/**
 * Normalised payment shape returned by `CheckoutProvider.getPayment`. The MP
 * SDK type has dozens of fields we don't care about; this surface keeps just
 * what the webhook handler needs.
 */
export interface ProviderPayment {
  /** Provider-side payment id (string-coerced). */
  id: string;
  /** The preference we created the payment from. */
  preferenceId: string | null;
  status: ProviderPaymentStatus;
  payer: {
    email: string | null;
    firstName: string | null;
  };
  /** Whatever the provider gives us back, kept for `mpRawData`. */
  rawData: Record<string, unknown>;
  /** Metadata we set at preference creation, roundtripped back. */
  metadata: {
    completionToken: string | null;
    paymentId: string | null;
  };
}

/** Output of `createPreference`. */
export interface CreatePreferenceResult {
  /** Provider-side preference id (used as MP webhook lookup key). */
  preferenceId: string;
  /** URL to redirect the buyer to. */
  initPoint: string;
}

/** Inputs for HMAC verification of an incoming webhook request. */
export interface VerifyWebhookSignatureParams {
  /** Value of the `x-signature` header. */
  signatureHeader: string;
  /** Value of the `x-request-id` header. */
  requestId: string;
  /** `body.data.id` from the webhook payload. */
  dataId: string;
}

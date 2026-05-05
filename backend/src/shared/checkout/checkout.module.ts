import { Global, Module } from '@nestjs/common';
import { CHECKOUT_PROVIDER } from './checkout.provider.js';
import { MockCheckoutProvider } from './mock.provider.js';
import { MercadoPagoCheckoutProvider } from './mercadopago.provider.js';

/**
 * Wires the active `CheckoutProvider` implementation into DI.
 *
 * Selection rule:
 *   - `NODE_ENV === 'test'` → MockCheckoutProvider (backend E2E specs).
 *   - `NODE_ENV === 'development'` → MockCheckoutProvider so the
 *     frontend's `/dev/mock-checkout` page can drive the flow via the
 *     initPoint the mock returns. The real MP SDK is not viable locally
 *     because `MP_ACCESS_TOKEN` is a placeholder.
 *   - everything else (staging, production) → MercadoPagoCheckoutProvider.
 *
 * Marked `@Global` so the future PaymentsModule can inject the token
 * without re-importing this module everywhere.
 */
@Global()
@Module({
  providers: [
    MockCheckoutProvider,
    MercadoPagoCheckoutProvider,
    {
      provide: CHECKOUT_PROVIDER,
      useFactory: (
        mock: MockCheckoutProvider,
        mp: MercadoPagoCheckoutProvider,
      ) => {
        const env = process.env.NODE_ENV;
        return env === 'test' || env === 'development' ? mock : mp;
      },
      inject: [MockCheckoutProvider, MercadoPagoCheckoutProvider],
    },
  ],
  exports: [CHECKOUT_PROVIDER, MockCheckoutProvider],
})
export class CheckoutModule {}

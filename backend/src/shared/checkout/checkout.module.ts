import { Global, Module } from '@nestjs/common';
import { CHECKOUT_PROVIDER } from './checkout.provider.js';
import { MockCheckoutProvider } from './mock.provider.js';
import { MercadoPagoCheckoutProvider } from './mercadopago.provider.js';

/**
 * Wires the active `CheckoutProvider` implementation into DI.
 *
 * Selection rule: `NODE_ENV === 'test'` binds the in-memory mock so E2E
 * tests can drive the public payment flow deterministically. Every other
 * environment (development, staging, production) binds the real
 * MercadoPago SDK-backed provider.
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
      ) => (process.env.NODE_ENV === 'test' ? mock : mp),
      inject: [MockCheckoutProvider, MercadoPagoCheckoutProvider],
    },
  ],
  exports: [CHECKOUT_PROVIDER, MockCheckoutProvider],
})
export class CheckoutModule {}

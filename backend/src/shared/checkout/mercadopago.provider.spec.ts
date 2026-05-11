import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { MercadoPagoCheckoutProvider } from './mercadopago.provider.js';

/**
 * Unit test for the HMAC webhook verifier. We don't exercise the
 * `createPreference` / `getPayment` paths here because they reach the
 * MP API; they're covered indirectly by the E2E test that swaps in
 * `MockCheckoutProvider`.
 *
 * The provider builds its `env` from `loadEnv()` in the constructor, which
 * already resolves `MP_WEBHOOK_SECRET` from `.env` (loaded by jest.setup.js).
 * That same secret is used to sign the test fixtures below.
 */
describe('MercadoPagoCheckoutProvider.verifyWebhookSignature', () => {
  const SECRET = process.env.MP_WEBHOOK_SECRET ?? 'dev-webhook-secret';
  const REQUEST_ID = 'req-123';
  const DATA_ID = 'pay_42';

  /**
   * `ts` se computa fresh por test porque ahora el verifier rechaza
   * timestamps fuera de ±5 min. Si fuera estático (ej. `1700000000`)
   * los tests pasarían hoy y romperían mañana cuando la replay window
   * expire.
   */
  function freshTs(): string {
    return Math.floor(Date.now() / 1000).toString();
  }

  function sign(secret: string, ts: string, dataId: string, requestId: string): string {
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    return createHmac('sha256', secret).update(manifest).digest('hex');
  }

  let provider: MercadoPagoCheckoutProvider;

  beforeAll(() => {
    provider = new MercadoPagoCheckoutProvider();
  });

  it('accepts a correctly-signed manifest with a fresh ts', () => {
    const ts = freshTs();
    const v1 = sign(SECRET, ts, DATA_ID, REQUEST_ID);
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: `ts=${ts},v1=${v1}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).not.toThrow();
  });

  it('rejects when v1 hash is altered', () => {
    const ts = freshTs();
    const v1 = sign(SECRET, ts, DATA_ID, REQUEST_ID);
    const tampered = v1.slice(0, -2) + (v1.endsWith('aa') ? 'bb' : 'aa');
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: `ts=${ts},v1=${tampered}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when manifest fields differ from the signed ones', () => {
    const ts = freshTs();
    const v1 = sign(SECRET, ts, DATA_ID, REQUEST_ID);
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: `ts=${ts},v1=${v1}`,
        requestId: 'different-req',
        dataId: DATA_ID,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when the signature header is missing v1', () => {
    const ts = freshTs();
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: `ts=${ts}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when the signature header is missing ts', () => {
    const ts = freshTs();
    const v1 = sign(SECRET, ts, DATA_ID, REQUEST_ID);
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: `v1=${v1}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when v1 is not valid hex', () => {
    const ts = freshTs();
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: `ts=${ts},v1=not-hex-zz`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when ts is outside the replay window (old timestamp)', () => {
    // ts hace 1 año; firma "válida" pero replay protection lo rechaza
    // antes de chequear HMAC. Importante: el atacante podría tener una
    // firma legítima vieja capturada de logs y querer replayearla.
    const oldTs = String(Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60);
    const v1 = sign(SECRET, oldTs, DATA_ID, REQUEST_ID);
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: `ts=${oldTs},v1=${v1}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toThrow(/replay window/i);
  });

  it('rejects when ts is non-numeric', () => {
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: 'ts=not-a-number,v1=abc',
        requestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toThrow(/numeric/i);
  });

  it('accepts ts in milliseconds (some MP environments emit ms)', () => {
    const tsMillis = String(Date.now());
    const v1 = sign(SECRET, tsMillis, DATA_ID, REQUEST_ID);
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: `ts=${tsMillis},v1=${v1}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).not.toThrow();
  });

  it('rejects when any required field is empty', () => {
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: '',
        requestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toThrow(UnauthorizedException);
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: 'ts=1,v1=abc',
        requestId: '',
        dataId: DATA_ID,
      }),
    ).toThrow(UnauthorizedException);
  });
});

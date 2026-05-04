import { MockCheckoutProvider } from './mock.provider.js';

describe('MockCheckoutProvider', () => {
  let provider: MockCheckoutProvider;

  beforeEach(() => {
    provider = new MockCheckoutProvider();
  });

  it('mints sequential preference ids', async () => {
    const a = await provider.createPreference({
      paymentId: 'pay_a',
      amount: 15000,
      completionTokenPlain: 'tok_a',
    });
    const b = await provider.createPreference({
      paymentId: 'pay_b',
      amount: 15000,
      completionTokenPlain: 'tok_b',
    });
    expect(a.preferenceId).toBe('mock_pref_1');
    expect(b.preferenceId).toBe('mock_pref_2');
    expect(a.initPoint).toContain('mock_pref_1');
  });

  it('simulatePayment mints payment id and roundtrips metadata', async () => {
    const pref = await provider.createPreference({
      paymentId: 'pay_42',
      amount: 15000,
      completionTokenPlain: 'token-plain',
    });
    const dataId = provider.simulatePayment({
      preferenceId: pref.preferenceId,
      status: 'APPROVED',
      payerEmail: 'buyer@example.com',
      payerName: 'Lionel',
    });
    expect(dataId).toBe('mock_pay_1');

    const payment = await provider.getPayment(dataId);
    expect(payment.id).toBe('mock_pay_1');
    expect(payment.preferenceId).toBe(pref.preferenceId);
    expect(payment.status).toBe('APPROVED');
    expect(payment.payer.email).toBe('buyer@example.com');
    expect(payment.payer.firstName).toBe('Lionel');
    expect(payment.metadata.completionToken).toBe('token-plain');
    expect(payment.metadata.paymentId).toBe('pay_42');
  });

  it('getPayment throws when the id is unknown', async () => {
    await expect(provider.getPayment('mock_pay_999')).rejects.toThrow();
  });

  it('simulatePayment throws when the preference id is unknown', () => {
    expect(() =>
      provider.simulatePayment({
        preferenceId: 'mock_pref_doesnt_exist',
        status: 'APPROVED',
      }),
    ).toThrow();
  });

  it('verifyWebhookSignature is a no-op', () => {
    expect(() =>
      provider.verifyWebhookSignature({
        signatureHeader: 'whatever',
        requestId: 'whatever',
        dataId: 'whatever',
      }),
    ).not.toThrow();
  });

  it('reset clears counters and stores', async () => {
    await provider.createPreference({
      paymentId: 'pay_a',
      amount: 1,
      completionTokenPlain: 'tok',
    });
    provider.reset();
    const next = await provider.createPreference({
      paymentId: 'pay_b',
      amount: 1,
      completionTokenPlain: 'tok',
    });
    expect(next.preferenceId).toBe('mock_pref_1');
  });
});

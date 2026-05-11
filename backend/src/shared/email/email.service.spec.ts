import { jest } from '@jest/globals';
import { EmailService } from './email.service.js';

type SendFn = (payload: unknown) => Promise<{ data: unknown; error: unknown }>;

function injectClient(svc: EmailService, send: SendFn) {
  // Bypass the lazy Resend SDK construction by injecting a fake client
  // exposing only the surface we use.
  (svc as unknown as { client: { emails: { send: SendFn } } }).client = {
    emails: { send },
  };
}

describe('EmailService', () => {
  const ORIGINAL_KEY = process.env.RESEND_API_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = ORIGINAL_KEY;
    jest.restoreAllMocks();
  });

  it('simulates the send (resolves) when RESEND_API_KEY is absent', async () => {
    delete process.env.RESEND_API_KEY;
    const svc = new EmailService();
    await expect(
      svc.send({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }),
    ).resolves.toBeUndefined();
  });

  it('throws if neither html nor text is provided', async () => {
    delete process.env.RESEND_API_KEY;
    const svc = new EmailService();
    await expect(
      svc.send({ to: 'a@b.com', subject: 's' }),
    ).rejects.toThrow(/html|text/);
  });

  it('forwards { from, to, subject, html, text } to Resend when key is set', async () => {
    process.env.RESEND_API_KEY = 're_live_key';
    const send = jest
      .fn<SendFn>()
      .mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const svc = new EmailService();
    injectClient(svc, send);

    await svc.send({
      to: 'a@b.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.to).toBe('a@b.com');
    expect(payload.subject).toBe('hi');
    expect(payload.html).toBe('<p>hi</p>');
    expect(payload.text).toBe('hi');
    // EMAIL_FROM is loaded from .env (noreply@prodeplus.com)
    expect(typeof payload.from).toBe('string');
    expect((payload.from as string).length).toBeGreaterThan(0);
  });

  it('throws when Resend reports an error so BullMQ retries kick in', async () => {
    process.env.RESEND_API_KEY = 're_live_key';
    const send = jest.fn<SendFn>().mockResolvedValue({
      data: null,
      error: {
        name: 'invalid_api_key',
        statusCode: 401,
        message: 'bad key',
      },
    });
    const svc = new EmailService();
    injectClient(svc, send);

    await expect(
      svc.send({ to: 'a@b.com', subject: 's', text: 'x' }),
    ).rejects.toThrow(/bad key|401/);
  });
});

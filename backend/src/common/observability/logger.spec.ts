import { jest } from '@jest/globals';
import { pino } from 'pino';
import { Writable } from 'node:stream';

/**
 * Smoke test for the pino redactor configuration applied in
 * `app.module.ts`. We can't trivially boot the full Nest app inside the
 * unit test (it owns its own destination), so this spec instantiates a
 * pino instance with the same redact paths and asserts that the
 * canonical sensitive fields are scrubbed.
 *
 * Keeping the redact list in sync with `app.module.ts` is enforced by
 * code review: changes to one MUST update the other. The plan and
 * spec sections 9.2 are the authoritative source of truth.
 */
describe('pino logger redaction', () => {
  function captureLog(): {
    logger: ReturnType<typeof pino>;
    output: () => Record<string, unknown> | null;
  } {
    let captured = '';
    const stream = new Writable({
      write(chunk, _enc, cb) {
        captured += chunk.toString();
        cb();
      },
    });
    const logger = pino(
      {
        redact: {
          paths: [
            'password',
            'passwordHash',
            '*.password',
            '*.passwordHash',
            '*.token',
            '*.cardNumber',
            '*.cvv',
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-turnstile-token"]',
          ],
          censor: '[REDACTED]',
        },
      },
      stream,
    );
    return {
      logger,
      output: () => {
        const trimmed = captured.trim();
        if (!trimmed) return null;
        // pino can emit multiple lines if logged repeatedly — take the last.
        const last = trimmed.split('\n').pop() as string;
        return JSON.parse(last);
      },
    };
  }

  it('redacts password and passwordHash at the top level', () => {
    const { logger, output } = captureLog();
    logger.info({ password: 'super-secret', passwordHash: '$2b$xxx' }, 'login');
    const out = output()!;
    expect(out.password).toBe('[REDACTED]');
    expect(out.passwordHash).toBe('[REDACTED]');
  });

  it('redacts nested .token, .cardNumber, .cvv', () => {
    const { logger, output } = captureLog();
    logger.info({
      payload: {
        token: 'abc',
        cardNumber: '4111111111111111',
        cvv: '123',
      },
    });
    const out = output()!;
    const payload = out.payload as Record<string, unknown>;
    expect(payload.token).toBe('[REDACTED]');
    expect(payload.cardNumber).toBe('[REDACTED]');
    expect(payload.cvv).toBe('[REDACTED]');
  });

  it('redacts authorization, cookie and x-turnstile-token headers', () => {
    const { logger, output } = captureLog();
    logger.info({
      req: {
        headers: {
          authorization: 'Bearer xxx',
          cookie: 'sess=abc',
          'x-turnstile-token': 'cf-token',
          'user-agent': 'jest',
        },
      },
    });
    const out = output()!;
    const req = out.req as { headers: Record<string, unknown> };
    expect(req.headers.authorization).toBe('[REDACTED]');
    expect(req.headers.cookie).toBe('[REDACTED]');
    expect(req.headers['x-turnstile-token']).toBe('[REDACTED]');
    // Other headers stay visible.
    expect(req.headers['user-agent']).toBe('jest');
  });
});

import { jest } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TurnstileGuard } from './turnstile.guard.js';

/**
 * Builds a tiny `ExecutionContext` shim around a partial request. Only
 * the `switchToHttp().getRequest()` shape is used by the guard.
 */
function ctxFromReq(req: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY;
  } else {
    process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
  }
});

describe('TurnstileGuard', () => {
  it('bypasses verification when NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    const guard = new TurnstileGuard();
    // Even with no token in the request, NODE_ENV=test short-circuits.
    expect(await guard.canActivate(ctxFromReq({ headers: {}, body: {} }))).toBe(
      true,
    );
  });

  it('passes with a warning when TURNSTILE_SECRET_KEY is unset', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TURNSTILE_SECRET_KEY;
    const guard = new TurnstileGuard();
    expect(await guard.canActivate(ctxFromReq({ headers: {}, body: {} }))).toBe(
      true,
    );
  });

  it('rejects when no token is supplied (in non-test envs with secret)', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    const guard = new TurnstileGuard();
    await expect(
      guard.canActivate(ctxFromReq({ headers: {}, body: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('passes when Cloudflare returns success=true', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      }) as unknown as typeof fetch;
    const guard = new TurnstileGuard();
    const ctx = ctxFromReq({
      headers: { 'x-turnstile-token': 'cf-token' },
      body: {},
      ip: '1.2.3.4',
      socket: {},
    });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects when Cloudflare returns success=false', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: false,
        'error-codes': ['invalid-input-response'],
      }),
    }) as unknown as typeof fetch;
    const guard = new TurnstileGuard();
    const ctx = ctxFromReq({
      headers: {},
      body: { turnstileToken: 'bogus' },
      ip: '1.2.3.4',
      socket: {},
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('fails closed on network error from Cloudflare', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const guard = new TurnstileGuard();
    const ctx = ctxFromReq({
      headers: { 'x-turnstile-token': 't' },
      body: {},
      socket: {},
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

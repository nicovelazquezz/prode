import { describe, it, expect, beforeEach } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BearerGuard } from './bearer.guard.js';

const TOKEN = 'a'.repeat(32);

function ctxWithHeader(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
  } as unknown as ExecutionContext;
}

describe('BearerGuard', () => {
  let guard: BearerGuard;

  beforeEach(() => {
    guard = new BearerGuard({ WA_API_TOKEN: TOKEN } as never);
  });

  it('allows when Bearer token matches', () => {
    expect(guard.canActivate(ctxWithHeader(`Bearer ${TOKEN}`))).toBe(true);
  });

  it('rejects when Authorization header is missing', () => {
    expect(() => guard.canActivate(ctxWithHeader())).toThrow(UnauthorizedException);
  });

  it('rejects when scheme is not Bearer', () => {
    expect(() => guard.canActivate(ctxWithHeader(`Basic ${TOKEN}`))).toThrow(UnauthorizedException);
  });

  it('rejects when token differs', () => {
    expect(() =>
      guard.canActivate(ctxWithHeader(`Bearer ${'b'.repeat(32)}`)),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when token length differs (no timing leak)', () => {
    expect(() => guard.canActivate(ctxWithHeader(`Bearer short`))).toThrow(
      UnauthorizedException,
    );
  });
});

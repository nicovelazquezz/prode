import { jest } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import {
  JwtAuthGuard,
  type AccessTokenVerifier,
} from './jwt-auth.guard.js';

function makeContext(headers: Record<string, string>): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string>; user?: unknown };
  handler: () => void;
  controllerClass: new () => unknown;
} {
  const req: { headers: Record<string, string>; user?: unknown } = { headers };
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const handler = () => {};
  class FakeController {}
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => FakeController,
  } as unknown as ExecutionContext;
  return { ctx, req, handler, controllerClass: FakeController };
}

function makeReflectorReturning(value: unknown): Reflector {
  const r = new Reflector();
  jest.spyOn(r, 'getAllAndOverride').mockReturnValue(value as never);
  return r;
}

function makeVerifier(
  result: ReturnType<AccessTokenVerifier['verifyAccessToken']>,
): AccessTokenVerifier {
  return { verifyAccessToken: jest.fn(() => result) };
}

describe('JwtAuthGuard', () => {
  it('allows the request when @Public() metadata is set', () => {
    const reflector = makeReflectorReturning(true);
    const verifier = makeVerifier({ sub: 'u1', role: 'USER' });
    const guard = new JwtAuthGuard(reflector, verifier);
    const { ctx } = makeContext({});

    expect(guard.canActivate(ctx)).toBe(true);
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('throws 401 when Authorization header is missing', () => {
    const reflector = makeReflectorReturning(undefined);
    const verifier = makeVerifier(null);
    const guard = new JwtAuthGuard(reflector, verifier);
    const { ctx } = makeContext({});

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when scheme is not Bearer', () => {
    const reflector = makeReflectorReturning(undefined);
    const verifier = makeVerifier(null);
    const guard = new JwtAuthGuard(reflector, verifier);
    const { ctx } = makeContext({ authorization: 'Basic abc' });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when bearer token is empty', () => {
    const reflector = makeReflectorReturning(undefined);
    const verifier = makeVerifier(null);
    const guard = new JwtAuthGuard(reflector, verifier);
    const { ctx } = makeContext({ authorization: 'Bearer ' });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when verifier rejects the token', () => {
    const reflector = makeReflectorReturning(undefined);
    const verifier = makeVerifier(null);
    const guard = new JwtAuthGuard(reflector, verifier);
    const { ctx } = makeContext({ authorization: 'Bearer faketoken' });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith('faketoken');
  });

  it('attaches request.user with id+role on a valid token', () => {
    const reflector = makeReflectorReturning(undefined);
    const verifier = makeVerifier({ sub: 'usr_42', role: 'ADMIN' });
    const guard = new JwtAuthGuard(reflector, verifier);
    const { ctx, req } = makeContext({ authorization: 'Bearer goodtoken' });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.user).toEqual({ id: 'usr_42', role: 'ADMIN' });
  });
});

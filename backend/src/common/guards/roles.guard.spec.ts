import { jest } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';

function makeContext(user: AuthenticatedUser | undefined): ExecutionContext {
  const req = { user };
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const handler = () => {};
  class FakeController {}
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => FakeController,
  } as unknown as ExecutionContext;
}

function reflectorReturning(value: unknown): Reflector {
  const r = new Reflector();
  jest.spyOn(r, 'getAllAndOverride').mockReturnValue(value as never);
  return r;
}

describe('RolesGuard', () => {
  it('is a no-op when no @Roles metadata is set', () => {
    const guard = new RolesGuard(reflectorReturning(undefined));
    expect(guard.canActivate(makeContext({ id: 'u', role: 'USER' }))).toBe(
      true,
    );
  });

  it('treats empty roles array as no-op', () => {
    const guard = new RolesGuard(reflectorReturning([]));
    expect(guard.canActivate(makeContext({ id: 'u', role: 'USER' }))).toBe(
      true,
    );
  });

  it('throws 403 if no user is on the request', () => {
    const guard = new RolesGuard(reflectorReturning(['ADMIN']));
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('throws 403 when the user role is not allowed', () => {
    const guard = new RolesGuard(reflectorReturning(['ADMIN']));
    expect(() =>
      guard.canActivate(makeContext({ id: 'u', role: 'USER' })),
    ).toThrow(ForbiddenException);
  });

  it('allows the request when the user matches one of the required roles', () => {
    const guard = new RolesGuard(reflectorReturning(['ADMIN', 'USER']));
    expect(guard.canActivate(makeContext({ id: 'u', role: 'USER' }))).toBe(
      true,
    );
  });
});

import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { ACCESS_TOKEN_VERIFIER } from '../../common/guards/jwt-auth.guard.js';

/**
 * Global so `AuthService` is injectable everywhere without re-importing
 * the module. Also registers the `ACCESS_TOKEN_VERIFIER` token (consumed
 * by `JwtAuthGuard`) bound to `AuthService`.
 *
 * Controllers/refresh-token services arrive in later tasks (3.4+).
 */
@Global()
@Module({
  providers: [
    AuthService,
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: AuthService },
  ],
  exports: [AuthService, ACCESS_TOKEN_VERIFIER],
})
export class AuthModule {}

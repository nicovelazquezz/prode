import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { RefreshTokensService } from './refresh-tokens.service.js';
import { UsersModule } from '../users/users.module.js';
import { ACCESS_TOKEN_VERIFIER } from '../../common/guards/jwt-auth.guard.js';

/**
 * Global so `AuthService` is injectable everywhere without re-importing
 * the module. Also registers the `ACCESS_TOKEN_VERIFIER` token (consumed
 * by `JwtAuthGuard`) bound to `AuthService`.
 */
@Global()
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokensService,
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: AuthService },
  ],
  exports: [AuthService, RefreshTokensService, ACCESS_TOKEN_VERIFIER],
})
export class AuthModule {}

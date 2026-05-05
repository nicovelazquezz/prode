import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { DevController } from './dev.controller.js';

/**
 * Dev-only module. Conditionally imported by `AppModule` when
 * `NODE_ENV !== 'production'` so its routes never compile into the
 * prod application surface. The controller also re-checks the env at
 * runtime as defense in depth.
 *
 * `PaymentsModule` is imported so we can reuse `PaymentsService` (and
 * its full webhook side-effect pipeline) from the simulate-webhook
 * endpoint. `AuthService` comes from the @Global AuthModule already.
 */
@Module({
  imports: [PrismaModule, PaymentsModule],
  controllers: [DevController],
})
export class DevModule {}

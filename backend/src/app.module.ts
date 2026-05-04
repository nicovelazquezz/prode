import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { PrismaModule } from './shared/prisma/prisma.module.js';
import { RedisModule } from './shared/redis/redis.module.js';
import { BullMqModule } from './shared/bullmq/bullmq.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { AdminAlertsModule } from './shared/admin-alerts/admin-alerts.module.js';
import { CheckoutModule } from './shared/checkout/checkout.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter.js';

/**
 * Wires the application-wide ValidationPipe, JwtAuthGuard, AuditInterceptor,
 * and exception filters so they apply uniformly in production AND inside
 * integration tests built via `Test.createTestingModule(AppModule)`.
 *
 * Filter ordering (Nest applies in reverse declaration order):
 *   PrismaExceptionFilter runs first (handles known DB error codes);
 *   GlobalExceptionFilter is the last-resort safety net.
 */
@Module({
  imports: [
    // ScheduleModule.forRoot() enables `@Cron`-based jobs (Tasks 5.8/5.9
    // and the match-related crons in later phases). Stays here so the
    // root context exposes the scheduler to feature modules.
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    BullMqModule,
    AuditModule,
    NotificationsModule,
    AdminAlertsModule,
    CheckoutModule,
    UsersModule,
    AuthModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          transform: true,
          forbidNonWhitelisted: true,
        }),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}

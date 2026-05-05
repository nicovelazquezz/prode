import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { loadEnv } from './config/env.js';
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
import { MatchesModule } from './modules/matches/matches.module.js';
import { PredictionsModule } from './modules/predictions/predictions.module.js';
import { ScoringModule } from './modules/scoring/scoring.module.js';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module.js';
import { LeaguesModule } from './modules/leagues/leagues.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter.js';
import { AppThrottlerModule } from './common/throttler/throttler.module.js';

/**
 * Wires the application-wide ValidationPipe, JwtAuthGuard, AuditInterceptor,
 * and exception filters so they apply uniformly in production AND inside
 * integration tests built via `Test.createTestingModule(AppModule)`.
 *
 * Filter ordering (Nest applies in reverse declaration order):
 *   PrismaExceptionFilter runs first (handles known DB error codes);
 *   GlobalExceptionFilter is the last-resort safety net.
 */
/**
 * Pino logger config (spec 9.2):
 *   - JSON in production / pretty-printed in dev
 *   - redactor scrubs password, *.token, *.cardNumber, *.cvv,
 *     authorization & cookie headers from logs
 *   - per-request `requestId` (echoes incoming `x-request-id` if any)
 *   - skips logging the `/health` poll to keep operational noise down
 */
function buildLoggerParams() {
  const env = loadEnv();
  const isProd = env.NODE_ENV === 'production';
  return {
    pinoHttp: {
      level: isProd ? 'info' : 'debug',
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
      transport: !isProd ? { target: 'pino-pretty' } : undefined,
      autoLogging: {
        ignore: (req: IncomingMessage) => req.url === '/health',
      },
      customProps: (req: IncomingMessage) => {
        const inbound = req.headers['x-request-id'];
        const requestId =
          (Array.isArray(inbound) ? inbound[0] : inbound) ?? randomUUID();
        return { requestId };
      },
    },
  };
}

@Module({
  imports: [
    // Pino logger goes first so feature modules that emit during boot
    // (RedisModule, BullMqModule, ScheduleModule) get structured output.
    LoggerModule.forRoot(buildLoggerParams()),
    // ScheduleModule.forRoot() enables `@Cron`-based jobs (Tasks 5.8/5.9
    // and the match-related crons in later phases). Stays here so the
    // root context exposes the scheduler to feature modules.
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    BullMqModule,
    AppThrottlerModule,
    AuditModule,
    NotificationsModule,
    AdminAlertsModule,
    CheckoutModule,
    UsersModule,
    AuthModule,
    PaymentsModule,
    MatchesModule,
    PredictionsModule,
    ScoringModule,
    LeaderboardModule,
    LeaguesModule,
    AdminModule,
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

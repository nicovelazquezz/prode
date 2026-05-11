import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BaileysModule } from './modules/baileys/baileys.module.js';
import { SendModule } from './modules/send/send.module.js';
import { StatusModule } from './modules/status/status.module.js';
import { WatchdogModule } from './modules/watchdog/watchdog.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { ENV_TOKEN, loadEnv } from './config/env.js';
import { BearerGuard } from './common/auth/bearer.guard.js';

@Global()
@Module({
  imports: [BaileysModule, SendModule, StatusModule, WatchdogModule],
  providers: [
    { provide: ENV_TOKEN, useFactory: loadEnv },
    BearerGuard,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
  exports: [ENV_TOKEN, BearerGuard],
})
export class AppModule {}

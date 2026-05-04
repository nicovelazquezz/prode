import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { applyHttpHardening } from './common/security/http-hardening.js';
import { loadEnv } from './config/env.js';

/**
 * Application bootstrap. Global pipe, guard, interceptor, and filters
 * are wired via `APP_*` providers in `AppModule` so the same wiring
 * applies inside integration tests. helmet + CORS go through the same
 * `applyHttpHardening` helper so the integration suite can exercise
 * the production headers.
 */
async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // necesario para verificación de firma MP
  });
  app.use(cookieParser());
  applyHttpHardening(app, env);

  // Graceful shutdown hooks (Phase 12.6).
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend corriendo en :${port}`);
}

void bootstrap();

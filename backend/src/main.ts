import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

/**
 * Application bootstrap. Global pipe, guard, interceptor, and filters
 * are wired via `APP_*` providers in `AppModule` so the same wiring
 * applies inside integration tests.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // necesario para verificación de firma MP
  });
  app.use(cookieParser());

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend corriendo en :${port}`);
}

void bootstrap();

import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // necesario para verificación de firma MP
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Backend corriendo en :${port}`);
}

bootstrap();

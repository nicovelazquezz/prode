import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from './shared/prisma/prisma.service.js';
import { RedisService } from './shared/redis/redis.service.js';
import { Public } from './common/decorators/public.decorator.js';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const [dbOk, redisOk] = await Promise.all([
      this.prisma.ping(),
      this.redis.ping(),
    ]);

    // DB caído = backend no puede servir nada útil → 503 para que Docker /
    // Dokploy reinicien el container (puede ser un blip de red).
    // Redis caído = backend sigue sirviendo lecturas (leaderboard, predicciones
    // existentes) y BullMQ retrae internamente → 200 + degraded para que
    // monitoreo lo vea sin matar el container en loop.
    const status = !dbOk ? 'down' : !redisOk ? 'degraded' : 'ok';
    if (!dbOk) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status,
      db: dbOk,
      redis: redisOk,
      timestamp: new Date().toISOString(),
    };
  }
}

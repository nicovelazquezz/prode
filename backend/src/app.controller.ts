import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './shared/prisma/prisma.service.js';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health() {
    const dbOk = await this.prisma.ping();
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk,
      timestamp: new Date().toISOString(),
    };
  }
}

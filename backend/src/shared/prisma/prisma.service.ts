import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client.js';
import { loadEnv } from '../../config/env.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const env = loadEnv();
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
    super({ adapter, log: ['warn', 'error'] });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Postgres connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

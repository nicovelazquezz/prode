import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { PrismaService } from './shared/prisma/prisma.service.js';
import { RedisService } from './shared/redis/redis.service.js';

type ResMock = { status: jest.Mock };

function buildResMock(): ResMock {
  return { status: jest.fn() };
}

async function buildController(opts: {
  dbOk: boolean;
  redisOk: boolean;
}): Promise<AppController> {
  const ref = await Test.createTestingModule({
    controllers: [AppController],
    providers: [
      { provide: PrismaService, useValue: { ping: async () => opts.dbOk } },
      { provide: RedisService, useValue: { ping: async () => opts.redisOk } },
    ],
  }).compile();
  return ref.get(AppController);
}

describe('AppController.health', () => {
  it('returns status=ok when db and redis are both reachable', async () => {
    const controller = await buildController({ dbOk: true, redisOk: true });
    const res = buildResMock();
    const body = await controller.health(res as never);
    expect(body.status).toBe('ok');
    expect(body.db).toBe(true);
    expect(body.redis).toBe(true);
    expect(typeof body.timestamp).toBe('string');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns status=degraded with 200 when only redis is unreachable', async () => {
    const controller = await buildController({ dbOk: true, redisOk: false });
    const res = buildResMock();
    const body = await controller.health(res as never);
    expect(body.status).toBe('degraded');
    expect(body.db).toBe(true);
    expect(body.redis).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns status=down with 503 when db is unreachable', async () => {
    const controller = await buildController({ dbOk: false, redisOk: true });
    const res = buildResMock();
    const body = await controller.health(res as never);
    expect(body.status).toBe('down');
    expect(body.db).toBe(false);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('returns status=down with 503 when both db and redis are unreachable', async () => {
    const controller = await buildController({ dbOk: false, redisOk: false });
    const res = buildResMock();
    const body = await controller.health(res as never);
    expect(body.status).toBe('down');
    expect(body.db).toBe(false);
    expect(body.redis).toBe(false);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});

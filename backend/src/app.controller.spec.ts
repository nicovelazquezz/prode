import { Test } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { PrismaService } from './shared/prisma/prisma.service.js';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const ref = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: PrismaService,
          useValue: { ping: async () => true },
        },
      ],
    }).compile();
    controller = ref.get(AppController);
  });

  it('GET /health responds with status ok and db:true when db is reachable', async () => {
    const res = await controller.health();
    expect(res.status).toBe('ok');
    expect(res.db).toBe(true);
    expect(typeof res.timestamp).toBe('string');
  });
});

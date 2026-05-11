import { describe, it, expect, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { StatusController } from './status.controller.js';
import { BaileysClientService } from '../baileys/baileys.client.service.js';
import { BearerGuard } from '../../common/auth/bearer.guard.js';

describe('StatusController', () => {
  let controller: StatusController;
  const clientMock = {
    snapshot: () => ({
      connected: true,
      phone: '5491166660000',
      lastSeenAt: new Date('2026-05-07T12:00:00Z'),
    }),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StatusController],
      providers: [{ provide: BaileysClientService, useValue: clientMock }],
    })
      .overrideGuard(BearerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(StatusController);
  });

  it('GET /health returns { ok: true }', () => {
    expect(controller.health()).toEqual({ ok: true });
  });

  it('GET /status returns the snapshot serialised', () => {
    expect(controller.status()).toEqual({
      connected: true,
      phone: '5491166660000',
      lastSeenAt: '2026-05-07T12:00:00.000Z',
    });
  });
});

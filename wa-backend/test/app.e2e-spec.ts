import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

const TOKEN = 'a'.repeat(32);
process.env.WA_API_TOKEN = TOKEN;

import { AppModule } from '../src/app.module.js';
import { BaileysClientService } from '../src/modules/baileys/baileys.client.service.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

describe('wa-backend (e2e)', () => {
  let app: INestApplication;
  const fakeClient = {
    onModuleInit: jest.fn(),
    onApplicationShutdown: jest.fn(),
    snapshot: () => ({
      connected: true,
      phone: '5491166660000',
      lastSeenAt: new Date('2026-05-07T12:00:00Z'),
    }),
    sendText: jest
      .fn<(to: string, message: string) => Promise<{ messageId: string }>>()
      .mockResolvedValue({ messageId: 'WAMID-E2E' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BaileysClientService)
      .useValue(fakeClient)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health → 200', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /status without auth → 401', async () => {
    const res = await request(app.getHttpServer()).get('/status');
    expect(res.status).toBe(401);
  });

  it('GET /status with auth → 200 with snapshot', async () => {
    const res = await request(app.getHttpServer())
      .get('/status')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      connected: true,
      phone: '5491166660000',
      lastSeenAt: '2026-05-07T12:00:00.000Z',
    });
  });

  it('POST /send valid → 200 with messageId', async () => {
    const res = await request(app.getHttpServer())
      .post('/send')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ to: '+5491166660000', message: 'hola' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messageId: 'WAMID-E2E' });
  });

  it('POST /send invalid DTO → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/send')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ to: 'not-a-phone', message: '' });
    expect(res.status).toBe(400);
  });

  it('POST /send without auth → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/send')
      .send({ to: '+5491166660000', message: 'hola' });
    expect(res.status).toBe(401);
  });
});

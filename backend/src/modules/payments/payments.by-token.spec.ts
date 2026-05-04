import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { createHash } from 'node:crypto';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Integration test for `GET /payments/by-token/:token`. Exercises the four
 * branches: unknown token (404), expired (410), completed (410), valid
 * pending (200).
 *
 * Doesn't go through `POST /payments/init` because that would also create
 * a preference at the (mock) provider; the by-token endpoint is purely a
 * Postgres lookup, so we seed Payment rows directly.
 */
describe('GET /payments/by-token/:token (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  const seededIds: string[] = [];

  function sha256(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 30_000);

  afterAll(async () => {
    if (prisma && seededIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: seededIds } } });
    }
    if (app) await app.close();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  /** Helper: seed a Payment with an arbitrary status / token / TTL. */
  async function seed(args: {
    plainToken: string;
    status: 'PENDING' | 'APPROVED';
    tokenExpiresAt?: Date | null;
    completedAt?: Date | null;
    payerEmail?: string | null;
  }) {
    const p = await prisma.payment.create({
      data: {
        amount: 15000,
        method: 'MERCADOPAGO',
        status: args.status,
        completionTokenHash: sha256(args.plainToken),
        tokenExpiresAt: args.tokenExpiresAt ?? null,
        completedAt: args.completedAt ?? null,
        payerEmail: args.payerEmail ?? null,
      },
    });
    seededIds.push(p.id);
    return p;
  }

  it('returns 404 for an unknown token', async () => {
    const res = await request(app.getHttpServer()).get(
      '/payments/by-token/unknown-token-1234',
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with public state for a valid pending token', async () => {
    const plain = 'valid-pending-' + Date.now();
    const future = new Date(Date.now() + 24 * 3600 * 1000);
    await seed({
      plainToken: plain,
      status: 'APPROVED',
      tokenExpiresAt: future,
      payerEmail: 'buyer@example.com',
    });
    const res = await request(app.getHttpServer()).get(
      `/payments/by-token/${plain}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'APPROVED',
      expiresAt: future.toISOString(),
      completed: false,
      hasPayer: true,
    });
    // No leakage of internal ids / payer fields
    expect(Object.keys(res.body)).toEqual(
      expect.arrayContaining(['status', 'expiresAt', 'completed', 'hasPayer']),
    );
    expect(res.body).not.toHaveProperty('payerEmail');
    expect(res.body).not.toHaveProperty('id');
  });

  it('returns 410 when the token has expired', async () => {
    const plain = 'expired-' + Date.now();
    await seed({
      plainToken: plain,
      status: 'APPROVED',
      tokenExpiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app.getHttpServer()).get(
      `/payments/by-token/${plain}`,
    );
    expect(res.status).toBe(410);
  });

  it('returns 410 when the token has already been completed', async () => {
    const plain = 'used-' + Date.now();
    await seed({
      plainToken: plain,
      status: 'APPROVED',
      tokenExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      completedAt: new Date(),
    });
    const res = await request(app.getHttpServer()).get(
      `/payments/by-token/${plain}`,
    );
    expect(res.status).toBe(410);
  });

  it('reports hasPayer=false when no payer email was captured', async () => {
    const plain = 'no-payer-' + Date.now();
    await seed({
      plainToken: plain,
      status: 'APPROVED',
      tokenExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      payerEmail: null,
    });
    const res = await request(app.getHttpServer()).get(
      `/payments/by-token/${plain}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.hasPayer).toBe(false);
  });
});

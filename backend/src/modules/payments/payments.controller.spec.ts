import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { MockCheckoutProvider } from '../../shared/checkout/mock.provider.js';
import { CHECKOUT_PROVIDER } from '../../shared/checkout/checkout.provider.js';

/**
 * Integration test for `POST /payments/init`.
 *
 * Runs against the real Postgres (Phase 1 docker-compose) and the
 * MockCheckoutProvider (NODE_ENV=test forces the mock binding inside
 * CheckoutModule). No network or BullMQ touched here.
 */
describe('POST /payments/init (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mockProvider: MockCheckoutProvider;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    const provider = app.get(CHECKOUT_PROVIDER);
    if (!(provider instanceof MockCheckoutProvider)) {
      throw new Error(
        'Expected MockCheckoutProvider to be bound when NODE_ENV=test',
      );
    }
    mockProvider = provider;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.payment.deleteMany({
        where: { mpPreferenceId: { startsWith: 'mock_pref_' } },
      });
    }
    if (app) await app.close();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  beforeEach(() => {
    mockProvider.reset();
  });

  it('creates a PENDING payment + preference and returns initPoint', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/init')
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.paymentId).toEqual(expect.any(String));
    expect(res.body.initPoint).toMatch(/^https:\/\/mock\.local\/checkout\//);

    const payment = await prisma.payment.findUnique({
      where: { id: res.body.paymentId },
    });
    expect(payment).toBeTruthy();
    expect(payment?.status).toBe('PENDING');
    expect(payment?.method).toBe('MERCADOPAGO');
    expect(payment?.userId).toBeNull();
    expect(payment?.completionTokenHash).toEqual(expect.any(String));
    expect(payment?.completionTokenHash).toHaveLength(64); // sha256 hex
    expect(payment?.tokenExpiresAt).toBeNull(); // set on APPROVED, not at init
    expect(payment?.mpPreferenceId).toMatch(/^mock_pref_/);
    expect(payment?.amount.toString()).toBe('10000'); // from AppConfig seed
  });

  it('writes an audit log entry with action=payment.init', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/init')
      .send({});
    expect(res.status).toBe(201);

    // Audit logs are written fire-and-forget; give the event loop a tick
    // before reading.
    await new Promise((r) => setTimeout(r, 100));

    const log = await prisma.auditLog.findFirst({
      where: { action: 'payment.init', entityId: res.body.paymentId },
    });
    expect(log).toBeTruthy();
    expect(log?.entity).toBe('payment');
  });

  it('rejects unknown body fields (whitelist + forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/init')
      .send({ unexpected: 'field' });

    expect(res.status).toBe(400);
  });
});

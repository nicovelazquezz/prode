import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { MockCheckoutProvider } from '../../shared/checkout/mock.provider.js';
import { CHECKOUT_PROVIDER } from '../../shared/checkout/checkout.provider.js';

/**
 * End-to-end happy path of the public registration flow:
 *
 *   POST /payments/init
 *     → simulate APPROVED webhook with MockCheckoutProvider
 *     → POST /auth/complete-registration with the magic-link token
 *
 * Then re-uses the same token to prove it's now invalidated.
 *
 * NODE_ENV is forced to 'test' so the CheckoutModule binds the mock,
 * matching how `payments.webhook.spec.ts` is configured.
 */
describe('POST /auth/complete-registration (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mockProvider: MockCheckoutProvider;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  /** Track everything we create so afterAll can clean up surgically. */
  const createdPaymentIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    mockProvider = app.get(CHECKOUT_PROVIDER) as MockCheckoutProvider;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Order matters: refresh tokens + audit logs reference users; payments
      // reference users; users reference nothing. Deleting payments first
      // would orphan `payment.userId` only if we hadn't set it — which we
      // did, but ON DELETE SET NULL handles that. Belt-and-suspenders.
      if (createdUserIds.length > 0) {
        await prisma.refreshToken.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.auditLog.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
      }
      if (createdPaymentIds.length > 0) {
        await prisma.notification.deleteMany({
          where: {
            dedupKey: { in: createdPaymentIds.map((id) => `recovery:${id}`) },
          },
        });
        await prisma.payment.deleteMany({
          where: { id: { in: createdPaymentIds } },
        });
      }
      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
    }
    if (app) await app.close();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  /** Drives init + simulate-webhook and returns the magic-link token. */
  async function paidPayment(): Promise<{
    paymentId: string;
    plainToken: string;
  }> {
    const initRes = await request(app.getHttpServer())
      .post('/payments/init')
      .send({});
    expect(initRes.status).toBe(201);
    const paymentId: string = initRes.body.paymentId;
    createdPaymentIds.push(paymentId);

    const local = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const dataId = mockProvider.simulatePayment({
      preferenceId: local.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: 'buyer@example.com',
      payerName: 'Lionel',
    });

    const webhookRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', `req-${paymentId}`)
      .send({ type: 'payment', data: { id: dataId } });
    expect(webhookRes.status).toBe(200);

    // The plain token is in the recovery notification's message URL.
    const notif = await prisma.notification.findFirstOrThrow({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    const m = notif.message.match(/token=([0-9a-f]+)/);
    if (!m) throw new Error('Magic link token not found in notification');
    return { paymentId, plainToken: m[1] };
  }

  /**
   * Generates a unique 8-digit DNI per test run so re-running locally
   * doesn't trip the unique constraint on a sticky DB. We deliberately
   * stay outside the seeded admin range (`00000000`).
   */
  function uniqueDni(): string {
    const n = Date.now() % 90_000_000;
    return String(10_000_000 + n).slice(-8);
  }

  function uniqueWa(): string {
    const n = Date.now() % 1_000_000_000;
    return `549${String(1_000_000_000 + n).slice(-9)}`.slice(0, 13);
  }

  it('completes registration → 200 with accessToken + refresh cookie', async () => {
    const { paymentId, plainToken } = await paidPayment();
    const dni = uniqueDni();
    const whatsapp = uniqueWa();

    const res = await request(app.getHttpServer())
      .post('/auth/complete-registration')
      .send({
        token: plainToken,
        dni,
        firstName: 'Diego',
        lastName: 'Maradona',
        whatsapp,
        password: 'pelusa1986',
      });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user.dni).toBe(dni);
    expect(res.body.user.role).toBe('USER');
    const setCookie = res.headers['set-cookie'];
    const cookieList = Array.isArray(setCookie) ? setCookie : [setCookie];
    expect(cookieList.some((c: string) => c.startsWith('refresh_token='))).toBe(
      true,
    );

    const created = await prisma.user.findUniqueOrThrow({ where: { dni } });
    createdUserIds.push(created.id);

    // Payment is now linked + completed
    const finalPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(finalPayment.userId).toBe(created.id);
    expect(finalPayment.completedAt).toBeInstanceOf(Date);
  });

  it('reusing the same token after success → 410 already used', async () => {
    const { plainToken } = await paidPayment();
    const dni = uniqueDni();
    const whatsapp = uniqueWa();

    // First call succeeds
    const ok = await request(app.getHttpServer())
      .post('/auth/complete-registration')
      .send({
        token: plainToken,
        dni,
        firstName: 'Lionel',
        lastName: 'Messi',
        whatsapp,
        password: 'rosario10',
      });
    expect(ok.status).toBe(200);
    const userId = (
      await prisma.user.findUniqueOrThrow({ where: { dni } })
    ).id;
    createdUserIds.push(userId);

    // Second call must fail with the already-used signal (410 Gone) and
    // explicitly NOT 200 — the controller maps `payment.completedAt != null`
    // to CompletionAlreadyUsedException.
    const dni2 = uniqueDni();
    const wa2 = uniqueWa();
    const dup = await request(app.getHttpServer())
      .post('/auth/complete-registration')
      .send({
        token: plainToken,
        dni: dni2 === dni ? `${Number(dni) + 1}`.padStart(8, '0') : dni2,
        firstName: 'Otro',
        lastName: 'Usuario',
        whatsapp: wa2 === whatsapp ? `${Number(wa2) + 1}` : wa2,
        password: 'whatever1',
      });
    expect(dup.status).toBe(410);
    expect(dup.body.code).toBe('COMPLETION_ALREADY_USED');
  });

  it('unknown token → 404 invalid completion token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/complete-registration')
      .send({
        token: 'a'.repeat(64),
        dni: uniqueDni(),
        firstName: 'X',
        lastName: 'Y',
        whatsapp: uniqueWa(),
        password: 'pass1234',
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('INVALID_COMPLETION_TOKEN');
  });

  it('payment still PENDING (no webhook yet) → 400', async () => {
    // Init only — skip the webhook simulation so payment stays PENDING.
    const initRes = await request(app.getHttpServer())
      .post('/payments/init')
      .send({});
    expect(initRes.status).toBe(201);
    const paymentId: string = initRes.body.paymentId;
    createdPaymentIds.push(paymentId);

    // We need the plain token; for PENDING we can't read it from the
    // notification (none was created). Instead we hand-craft via the DB
    // path: hash a synthetic plain and store it on a fresh PENDING row,
    // then submit that plain — but simpler is to mutate the existing
    // payment to a known hash. We avoid both by checking the 400 branch
    // with a token whose hash we know exists. Easiest: re-init and read
    // the hash; brute-forcing the plain isn't possible, so we test the
    // status-not-APPROVED branch via direct DB manipulation.
    const knownPlain = 'b'.repeat(64);
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(knownPlain).digest('hex');
    await prisma.payment.update({
      where: { id: paymentId },
      data: { completionTokenHash: hash },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/complete-registration')
      .send({
        token: knownPlain,
        dni: uniqueDni(),
        firstName: 'X',
        lastName: 'Y',
        whatsapp: uniqueWa(),
        password: 'pass1234',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAYMENT_NOT_APPROVED');
  });
});

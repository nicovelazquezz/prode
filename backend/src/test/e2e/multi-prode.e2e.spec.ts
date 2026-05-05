import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import {
  createE2EApp,
  uniqueDni,
  uniqueWhatsapp,
  type E2EAppHandles,
} from '../helpers/e2e-app.js';
import { NOTIFICATIONS_QUEUE } from '../../modules/notifications/notifications.constants.js';

/**
 * Multi-prode E2E flow:
 *   1. New user registers (Entry #1 created automatically).
 *   2. Logged-in user calls POST /entries/init-payment → Payment(PENDING).
 *   3. mockProvider simulates APPROVED webhook → Entry #2 materialised.
 *   4. GET /entries/me returns 2 active entries with stats.
 *   5. Predictions are independent per entry: same match, different scores.
 *   6. Cap test: drop max_entries_per_user to 2; trying to create a 3rd
 *      returns 409 ENTRY_CAP_REACHED.
 *
 * Spec multi-prode §4.2 ("Usuario existente quiere otro prode") + §4.4.
 */
describe('E2E flow #multi-prode: agregar segundo prode + cap', () => {
  let h: E2EAppHandles;
  let queue: Queue;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  // Track AppConfig key changes so afterAll can restore them.
  let originalCap: string | null = null;

  beforeAll(async () => {
    h = await createE2EApp();
    queue = h.app.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE));
    await h.cleanDb();
    // Snapshot the cap so we can drop / restore it for the cap test.
    const row = await h.prisma.appConfig.findUnique({
      where: { key: 'max_entries_per_user' },
    });
    originalCap = row?.value ?? null;
    // Default cap = 5 — give breathing room for the +1 entry test.
    await h.prisma.appConfig.upsert({
      where: { key: 'max_entries_per_user' },
      create: {
        key: 'max_entries_per_user',
        value: '5',
        description: 'Máximo de entradas por usuario',
      },
      update: { value: '5' },
    });
    await new Promise((r) => setTimeout(r, 1500));
  }, 60_000);

  afterAll(async () => {
    if (h?.prisma) {
      const jobs = await queue.getJobs(['delayed', 'waiting']);
      for (const j of jobs) {
        if (j.name === 'admin-orphan-alert') {
          await j.remove().catch(() => undefined);
        }
      }
      // Restore the cap we touched.
      if (originalCap !== null) {
        await h.prisma.appConfig.update({
          where: { key: 'max_entries_per_user' },
          data: { value: originalCap },
        });
      }
      await h.cleanDb();
    }
    if (h?.closeApp) await h.closeApp();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  /**
   * Drives the public registration flow for a brand-new user.
   * Returns the access token + the resolved userId.
   */
  async function registerNewUser(): Promise<{
    accessToken: string;
    userId: string;
  }> {
    const init = await request(h.app.getHttpServer()).post('/payments/init').send({});
    expect(init.status).toBe(201);
    const paymentId = init.body.paymentId as string;

    const local = await h.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const dataId = h.mockProvider.simulatePayment({
      preferenceId: local.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: 'mp1-e2e@example.com',
      payerName: 'Diego',
    });

    const webhook = await request(h.app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', `req-${paymentId}`)
      .send({ type: 'payment', data: { id: dataId } });
    expect(webhook.status).toBe(200);

    const notif = await h.prisma.notification.findFirstOrThrow({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    const tokenMatch = notif.message.match(/token=([0-9a-f]+)/);
    expect(tokenMatch).not.toBeNull();
    const plainToken = tokenMatch![1];

    const dni = uniqueDni();
    const whatsapp = uniqueWhatsapp();
    const complete = await request(h.app.getHttpServer())
      .post('/auth/complete-registration')
      .send({
        token: plainToken,
        dni,
        firstName: 'MP',
        lastName: 'Tester',
        whatsapp,
        password: 'mp-e2e-pass1!',
      });
    expect(complete.status).toBe(200);
    const accessToken = complete.body.accessToken as string;
    const userId = complete.body.user.id as string;
    return { accessToken, userId };
  }

  it('happy path: register → add second prode → 2 entries → independent predictions', async () => {
    // ── 1. Register the user. complete-registration creates Entry #1.
    const { accessToken, userId } = await registerNewUser();

    // GET /entries/me returns 1 entry.
    const me1 = await request(h.app.getHttpServer())
      .get('/entries/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me1.status).toBe(200);
    expect(Array.isArray(me1.body)).toBe(true);
    expect(me1.body).toHaveLength(1);
    const entry1Id = me1.body[0].id as string;
    expect(me1.body[0].position).toBe(1);

    // ── 2. POST /entries/init-payment to start a second-prode payment.
    const init2 = await request(h.app.getHttpServer())
      .post('/entries/init-payment')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ alias: 'Mi prode optimista' });
    expect(init2.status).toBe(200);
    const payment2Id = init2.body.paymentId as string;
    expect(typeof init2.body.initPoint).toBe('string');

    // The new Payment is PENDING and carries the alias + userId.
    const pmt2Local = await h.prisma.payment.findUniqueOrThrow({
      where: { id: payment2Id },
    });
    expect(pmt2Local.status).toBe('PENDING');
    expect(pmt2Local.userId).toBe(userId);
    expect(pmt2Local.entryAlias).toBe('Mi prode optimista');

    // ── 3. Webhook approves payment → Entry #2 created in TX.
    const dataId2 = h.mockProvider.simulatePayment({
      preferenceId: pmt2Local.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: 'mp2-e2e@example.com',
      payerName: 'Diego',
    });
    const wh2 = await request(h.app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', `req2-${payment2Id}`)
      .send({ type: 'payment', data: { id: dataId2 } });
    expect(wh2.status).toBe(200);

    // ── 4. GET /entries/me returns 2 entries.
    const me2 = await request(h.app.getHttpServer())
      .get('/entries/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me2.status).toBe(200);
    expect(me2.body).toHaveLength(2);
    const entry2 = me2.body.find(
      (e: { position: number }) => e.position === 2,
    );
    expect(entry2).toBeDefined();
    expect(entry2.alias).toBe('Mi prode optimista');
    const entry2Id = entry2.id as string;

    // ── 5. Independent predictions per entry.
    const targetMatch = await h.prisma.match.findFirstOrThrow({
      where: { matchNumber: 96 },
    });
    if (targetMatch.predictionsLockAt.getTime() <= Date.now()) {
      await h.prisma.match.update({
        where: { id: targetMatch.id },
        data: { predictionsLockAt: new Date(Date.now() + 6 * 3600 * 1000) },
      });
    }

    const pred1 = await request(h.app.getHttpServer())
      .post(`/entries/${entry1Id}/predictions/match/${targetMatch.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ scoreHome: 3, scoreAway: 1 });
    expect(pred1.status).toBe(201);
    expect(pred1.body.entryId).toBe(entry1Id);

    const pred2 = await request(h.app.getHttpServer())
      .post(`/entries/${entry2Id}/predictions/match/${targetMatch.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ scoreHome: 0, scoreAway: 2 });
    expect(pred2.status).toBe(201);
    expect(pred2.body.entryId).toBe(entry2Id);

    // Both predictions persist independently.
    const all = await h.prisma.prediction.findMany({
      where: { matchId: targetMatch.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(all).toHaveLength(2);
    const e1Pred = all.find((p) => p.entryId === entry1Id);
    const e2Pred = all.find((p) => p.entryId === entry2Id);
    expect(e1Pred?.scoreHome).toBe(3);
    expect(e1Pred?.scoreAway).toBe(1);
    expect(e2Pred?.scoreHome).toBe(0);
    expect(e2Pred?.scoreAway).toBe(2);

    // GET /entries/:id returns the single-entry detail.
    const detail = await request(h.app.getHttpServer())
      .get(`/entries/${entry2Id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(entry2Id);
    expect(detail.body.stats.predictionsCount).toBe(1);

    // PATCH /entries/:id renames pre-kickoff.
    const rename = await request(h.app.getHttpServer())
      .patch(`/entries/${entry2Id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ alias: 'Mi prode random' });
    expect(rename.status).toBe(200);
    expect(rename.body.alias).toBe('Mi prode random');
  }, 60_000);

  it('cap reached: drop config to 2, third init returns 409 ENTRY_CAP_REACHED', async () => {
    // Drop the cap to 2 so the next user can only make one extra entry.
    await h.prisma.appConfig.update({
      where: { key: 'max_entries_per_user' },
      data: { value: '2' },
    });

    const { accessToken } = await registerNewUser();

    // First init: cap=2, current entries=1 → OK.
    const ok = await request(h.app.getHttpServer())
      .post('/entries/init-payment')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(ok.status).toBe(200);
    const payment2Id = ok.body.paymentId as string;
    const pmt2Local = await h.prisma.payment.findUniqueOrThrow({
      where: { id: payment2Id },
    });
    const dataId = h.mockProvider.simulatePayment({
      preferenceId: pmt2Local.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: 'cap-e2e@example.com',
      payerName: 'Diego',
    });
    const wh = await request(h.app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', `req-cap-${payment2Id}`)
      .send({ type: 'payment', data: { id: dataId } });
    expect(wh.status).toBe(200);

    // Second init: cap=2, current entries=2 → 409.
    const blocked = await request(h.app.getHttpServer())
      .post('/entries/init-payment')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('ENTRY_CAP_REACHED');
    expect(blocked.body.current).toBe(2);
    expect(blocked.body.cap).toBe(2);
  }, 60_000);
});

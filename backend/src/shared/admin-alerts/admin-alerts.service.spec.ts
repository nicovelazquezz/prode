import { jest } from '@jest/globals';
import { AdminAlertsService } from './admin-alerts.service.js';
import type { NotificationsService } from '../../modules/notifications/notifications.service.js';

function makeNotifMock() {
  const enqueue = jest.fn<NotificationsService['enqueue']>();
  // Return type isn't used by AdminAlertsService — undefined cast to any.
  enqueue.mockResolvedValue({} as never);
  return {
    notif: { enqueue } as unknown as NotificationsService,
    enqueue,
  };
}

describe('AdminAlertsService', () => {
  it('enqueues a WhatsApp ADMIN_BROADCAST to ADMIN_WHATSAPP_NUMBER', async () => {
    const { notif, enqueue } = makeNotifMock();
    const svc = new AdminAlertsService(notif);

    await svc.notify({
      type: 'PAYMENT_ORPHAN',
      message: 'pago sin registro completado pay_42',
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const args = enqueue.mock.calls[0][0];
    // Loaded from .env via loadEnv()
    expect(args.toAddress).toBe(process.env.ADMIN_WHATSAPP_NUMBER);
    expect(args.channel).toBe('WHATSAPP');
    expect(args.type).toBe('ADMIN_BROADCAST');
    expect(args.title).toBe('PAYMENT_ORPHAN');
    expect(args.message).toBe('pago sin registro completado pay_42');
    expect(args.userId).toBeNull();
    expect(args.dedupKey).toBeUndefined();
  });

  it('forwards dedupKey for events that may re-fire', async () => {
    const { notif, enqueue } = makeNotifMock();
    const svc = new AdminAlertsService(notif);

    await svc.notify({
      type: 'PAYMENT_ORPHAN',
      message: 'still pending',
      dedupKey: 'orphan:pay_42',
    });

    expect(enqueue.mock.calls[0][0].dedupKey).toBe('orphan:pay_42');
  });

  it('does not swallow errors from NotificationsService.enqueue', async () => {
    const { notif, enqueue } = makeNotifMock();
    enqueue.mockRejectedValueOnce(new Error('db down'));
    const svc = new AdminAlertsService(notif);

    await expect(
      svc.notify({ type: 'X', message: 'y' }),
    ).rejects.toThrow('db down');
  });
});

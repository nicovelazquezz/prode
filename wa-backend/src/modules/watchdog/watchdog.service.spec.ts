import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { Env } from '../../config/env.js';
import type { BaileysClientService } from '../baileys/baileys.client.service.js';
import { WatchdogService } from './watchdog.service.js';

const BASE_ENV: Env = {
  PORT: 3001,
  WA_API_TOKEN: 'a'.repeat(32),
  WA_AUTH_DIR: './data/auth',
  WA_SEND_DELAY_MS: 0,
  WA_VERIFY_RECIPIENT: false,
  WA_RECONNECT_MAX_BACKOFF_MS: 60_000,
  LOG_LEVEL: 'info' as const,
  WATCHDOG_ENABLED: true,
  BACKEND_HEALTH_URL: 'http://prode-backend:3001/health',
  WATCHDOG_INTERVAL_MS: 60_000,
  WATCHDOG_FAILURE_THRESHOLD: 3,
  WATCHDOG_FETCH_TIMEOUT_MS: 5_000,
  ADMIN_WHATSAPP_NUMBER: '5491166660000',
};

function mockBaileys(): {
  baileys: BaileysClientService;
  sendText: jest.Mock<BaileysClientService['sendText']>;
} {
  const sendText = jest.fn<BaileysClientService['sendText']>();
  sendText.mockResolvedValue({ messageId: 'WAMID-x' });
  const baileys = { sendText } as unknown as BaileysClientService;
  return { baileys, sendText };
}

function buildService(envOverrides: Partial<Env> = {}): {
  service: WatchdogService;
  sendText: jest.Mock<BaileysClientService['sendText']>;
} {
  const { baileys, sendText } = mockBaileys();
  const env: Env = { ...BASE_ENV, ...envOverrides };
  const service = new WatchdogService(env, baileys);
  return { service, sendText };
}

describe('WatchdogService', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('onApplicationBootstrap', () => {
    it('no arranca el timer si WATCHDOG_ENABLED=false', () => {
      const { service, sendText } = buildService({ WATCHDOG_ENABLED: false });
      jest.useFakeTimers();
      service.onApplicationBootstrap();
      jest.advanceTimersByTime(120_000);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
      service.onApplicationShutdown();
    });

    it('no arranca el timer si ADMIN_WHATSAPP_NUMBER no está seteado', () => {
      const { service } = buildService({ ADMIN_WHATSAPP_NUMBER: undefined });
      jest.useFakeTimers();
      service.onApplicationBootstrap();
      jest.advanceTimersByTime(120_000);
      expect(fetchSpy).not.toHaveBeenCalled();
      service.onApplicationShutdown();
    });
  });

  describe('tick — health OK', () => {
    it('no envía alertas y mantiene contador en 0', async () => {
      const { service, sendText } = buildService();
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));
      await service.tick();
      await service.tick();
      expect(sendText).not.toHaveBeenCalled();
    });
  });

  describe('tick — incrementa contador en fallas', () => {
    it('no alerta antes del threshold', async () => {
      const { service, sendText } = buildService({
        WATCHDOG_FAILURE_THRESHOLD: 3,
      });
      fetchSpy.mockResolvedValue(new Response('err', { status: 503 }));
      await service.tick();
      await service.tick();
      expect(sendText).not.toHaveBeenCalled();
    });

    it('alerta exactamente cuando alcanza el threshold', async () => {
      const { service, sendText } = buildService({
        WATCHDOG_FAILURE_THRESHOLD: 3,
      });
      fetchSpy.mockResolvedValue(new Response('err', { status: 503 }));
      await service.tick();
      await service.tick();
      await service.tick();
      expect(sendText).toHaveBeenCalledTimes(1);
      const [, message] = sendText.mock.calls[0]!;
      expect(message).toMatch(/Backend caído/);
      expect(message).toMatch(/3 chequeos consecutivos/);
    });

    it('no manda alertas duplicadas mientras sigue caído', async () => {
      const { service, sendText } = buildService({
        WATCHDOG_FAILURE_THRESHOLD: 2,
      });
      fetchSpy.mockResolvedValue(new Response('err', { status: 503 }));
      // 5 ticks consecutivos en down — solo 1 alerta
      for (let i = 0; i < 5; i += 1) await service.tick();
      expect(sendText).toHaveBeenCalledTimes(1);
    });
  });

  describe('tick — timeout cuenta como falla', () => {
    it('un fetch que arroja error incrementa contador', async () => {
      const { service, sendText } = buildService({
        WATCHDOG_FAILURE_THRESHOLD: 2,
      });
      fetchSpy.mockRejectedValue(new Error('network unreachable'));
      await service.tick();
      await service.tick();
      expect(sendText).toHaveBeenCalledTimes(1);
      const [, message] = sendText.mock.calls[0]!;
      expect(message).toMatch(/Backend caído/);
    });
  });

  describe('tick — degraded (200 con body diferente) no alerta', () => {
    it('cualquier 2xx cuenta como vivo aunque el body diga degraded', async () => {
      const { service, sendText } = buildService({
        WATCHDOG_FAILURE_THRESHOLD: 2,
      });
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ status: 'degraded', db: true, redis: false }), {
          status: 200,
        }),
      );
      for (let i = 0; i < 5; i += 1) await service.tick();
      expect(sendText).not.toHaveBeenCalled();
    });
  });

  describe('tick — recovery', () => {
    it('después de caída y notificación, vuelve OK → manda WA "recuperado"', async () => {
      const { service, sendText } = buildService({
        WATCHDOG_FAILURE_THRESHOLD: 2,
      });
      fetchSpy.mockResolvedValue(new Response('err', { status: 503 }));
      await service.tick();
      await service.tick();
      expect(sendText).toHaveBeenCalledTimes(1); // down alert

      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));
      await service.tick();
      expect(sendText).toHaveBeenCalledTimes(2);
      const [, recoveryMessage] = sendText.mock.calls[1]!;
      expect(recoveryMessage).toMatch(/recuperado/);
    });

    it('después de recovery, una nueva caída dispara otra alerta', async () => {
      const { service, sendText } = buildService({
        WATCHDOG_FAILURE_THRESHOLD: 2,
      });
      fetchSpy.mockResolvedValue(new Response('err', { status: 503 }));
      await service.tick();
      await service.tick(); // alert #1 (down)
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));
      await service.tick(); // alert #2 (recovery)
      fetchSpy.mockResolvedValue(new Response('err', { status: 503 }));
      await service.tick();
      await service.tick(); // alert #3 (down de nuevo)
      expect(sendText).toHaveBeenCalledTimes(3);
    });
  });

  describe('tick — error de Baileys no rompe el watchdog', () => {
    it('si sendText falla, el tick siguiente sigue funcionando', async () => {
      const { service, sendText } = buildService({
        WATCHDOG_FAILURE_THRESHOLD: 2,
      });
      sendText.mockRejectedValueOnce(new Error('Baileys disconnected'));
      fetchSpy.mockResolvedValue(new Response('err', { status: 503 }));
      await service.tick();
      // Esta es la que intenta enviar y falla
      await service.tick();
      // El estado interno marca `notified=true` igual (la alerta se
      // intentó), no hay reintentos automáticos. Próximo tick con
      // backend caído NO manda alerta (ya notificó). Acepté ese trade-off.
      expect(sendText).toHaveBeenCalledTimes(1);

      // Pero si vuelve OK, la recovery sí se intenta:
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));
      await service.tick();
      expect(sendText).toHaveBeenCalledTimes(2);
    });
  });
});

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { BaileysClientService } from './baileys.client.service.js';
import { BaileysConnectionState } from './baileys-connection-state.js';

const ENV = {
  PORT: 3001,
  WA_API_TOKEN: 'a'.repeat(32),
  WA_AUTH_DIR: './data/auth',
  WA_SEND_DELAY_MS: 0,
  WA_VERIFY_RECIPIENT: false,
  WA_RECONNECT_MAX_BACKOFF_MS: 60_000,
  LOG_LEVEL: 'info' as const,
  WATCHDOG_ENABLED: false,
  BACKEND_HEALTH_URL: 'http://localhost:3001/health',
  WATCHDOG_INTERVAL_MS: 60_000,
  WATCHDOG_FAILURE_THRESHOLD: 3,
  WATCHDOG_FETCH_TIMEOUT_MS: 5_000,
};

function svc(overrides: Partial<typeof ENV> = {}) {
  const s = new BaileysClientService({ ...ENV, ...overrides });
  // Inject a state so we can drive it from tests.
  (s as unknown as { state: BaileysConnectionState }).state =
    new BaileysConnectionState({ maxBackoffMs: 60_000 });
  return s;
}

describe('BaileysClientService.sendText', () => {
  it('throws ServiceUnavailable when not connected', async () => {
    const s = svc();
    await expect(s.sendText('+5491166...', 'hi')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('builds a jid from digits and forwards to sock.sendMessage', async () => {
    const s = svc();
    (
      s as unknown as { state: BaileysConnectionState }
    ).state.markConnected('5491166...');
    const sendMessage = jest
      .fn<(...args: unknown[]) => Promise<{ key: { id: string } }>>()
      .mockResolvedValue({ key: { id: 'WAMID-1' } });
    (s as unknown as { sock: unknown }).sock = {
      sendMessage,
      onWhatsApp: jest.fn(),
    };

    const result = await s.sendText('+54 9 11 6666-0000', 'hola');
    expect(sendMessage).toHaveBeenCalledWith('5491166660000@s.whatsapp.net', {
      text: 'hola',
    });
    expect(result).toEqual({ messageId: 'WAMID-1' });
  });

  it('verifies recipient when WA_VERIFY_RECIPIENT=true and rejects when not on WA', async () => {
    const s = svc({ WA_VERIFY_RECIPIENT: true });
    (
      s as unknown as { state: BaileysConnectionState }
    ).state.markConnected('5491166...');
    const onWhatsApp = jest
      .fn<(...args: unknown[]) => Promise<Array<{ exists: boolean }>>>()
      .mockResolvedValue([{ exists: false }]);
    (s as unknown as { sock: unknown }).sock = {
      sendMessage: jest.fn(),
      onWhatsApp,
    };

    await expect(s.sendText('+5491166660000', 'hola')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(onWhatsApp).toHaveBeenCalled();
  });
});

describe('BaileysClientService.handleConnectionUpdate', () => {
  let s: BaileysClientService;
  let scheduleReconnect: jest.Mock;

  beforeEach(() => {
    s = svc();
    scheduleReconnect = jest.fn();
    (s as unknown as { scheduleReconnect: () => void }).scheduleReconnect =
      scheduleReconnect as unknown as () => void;
  });

  it('marks connected on connection=open with phone parsed from sock.user.id', () => {
    (s as unknown as { sock: unknown }).sock = {
      user: { id: '5491166660000:42@s.whatsapp.net' },
    };
    (
      s as unknown as { handleConnectionUpdate: (u: unknown) => void }
    ).handleConnectionUpdate({ connection: 'open' });
    const snap = (
      s as unknown as { state: BaileysConnectionState }
    ).state.snapshot();
    expect(snap.connected).toBe(true);
    expect(snap.phone).toBe('5491166660000');
  });

  it('schedules reconnect on close with non-loggedOut error', () => {
    const err = new Boom('boom', { statusCode: 500 });
    (
      s as unknown as { handleConnectionUpdate: (u: unknown) => void }
    ).handleConnectionUpdate({
      connection: 'close',
      lastDisconnect: { error: err },
    });
    expect(
      (s as unknown as { state: BaileysConnectionState }).state.snapshot()
        .connected,
    ).toBe(false);
    expect(scheduleReconnect).toHaveBeenCalled();
  });

  it('does NOT reconnect on loggedOut', () => {
    const err = new Boom('logged out', {
      statusCode: DisconnectReason.loggedOut,
    });
    (
      s as unknown as { handleConnectionUpdate: (u: unknown) => void }
    ).handleConnectionUpdate({
      connection: 'close',
      lastDisconnect: { error: err },
    });
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });

  it('logs but does not change state when only qr is present', () => {
    (
      s as unknown as { handleConnectionUpdate: (u: unknown) => void }
    ).handleConnectionUpdate({ qr: '2@abc...' });
    expect(
      (s as unknown as { state: BaileysConnectionState }).state.snapshot()
        .connected,
    ).toBe(false);
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });
});

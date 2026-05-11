import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import baileysPkg, {
  DisconnectReason,
  useMultiFileAuthState,
  type ConnectionState,
  type WASocket,
} from 'baileys';
import type { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { ENV_TOKEN, type Env } from '../../config/env.js';
import {
  BaileysConnectionState,
  type ConnectionSnapshot,
} from './baileys-connection-state.js';

const makeWASocket =
  (baileysPkg as unknown as { default: typeof baileysPkg }).default ??
  (baileysPkg as unknown as typeof baileysPkg);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@Injectable()
export class BaileysClientService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(BaileysClientService.name);
  private readonly env: Env;
  private state: BaileysConnectionState;
  private sock: WASocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private saveCreds: (() => Promise<void>) | null = null;
  private shuttingDown = false;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.env = env;
    this.state = new BaileysConnectionState({
      maxBackoffMs: env.WA_RECONNECT_MAX_BACKOFF_MS,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      await this.sock?.end(undefined);
    } catch (err) {
      this.logger.warn(
        `Error during shutdown end(): ${(err as Error).message}`,
      );
    }
  }

  snapshot(): ConnectionSnapshot {
    return this.state.snapshot();
  }

  async sendText(to: string, message: string): Promise<{ messageId: string }> {
    if (!this.state.snapshot().connected || !this.sock) {
      throw new ServiceUnavailableException('WhatsApp not connected');
    }
    const digits = to.replace(/\D/g, '');
    if (!digits) throw new BadRequestException('Recipient is empty');
    const jid = `${digits}@s.whatsapp.net`;

    if (this.env.WA_VERIFY_RECIPIENT) {
      const results = await this.sock.onWhatsApp(jid);
      const info = results?.[0];
      if (!info?.exists) {
        throw new BadRequestException('Recipient is not on WhatsApp');
      }
    }

    let messageId: string;
    try {
      const result = await this.sock.sendMessage(jid, { text: message });
      messageId = result?.key?.id ?? '';
    } catch (err) {
      this.logger.warn(
        `sendMessage failed for ${this.redact(digits)}: ${(err as Error).message}`,
      );
      throw new BadGatewayException('Failed to send message');
    }

    if (this.env.WA_SEND_DELAY_MS > 0) await sleep(this.env.WA_SEND_DELAY_MS);
    this.logger.log(`sent to=${this.redact(digits)} id=${messageId}`);
    return { messageId };
  }

  // -- internals ----------------------------------------------------------

  private async connect(): Promise<void> {
    const { state: authState, saveCreds } = await useMultiFileAuthState(
      this.env.WA_AUTH_DIR,
    );
    this.saveCreds = saveCreds;
    this.sock = makeWASocket({
      auth: authState,
      printQRInTerminal: false,
      // `warn` (no `silent`) para que errores reales de red, TLS, o
      // protocolo Baileys ↔ WhatsApp salgan en logs y podamos
      // diagnosticar cuando la conexión falla antes de generar QR.
      logger: pino({ level: 'warn' }) as never,
      browser: ['ProdePlus', 'Chrome', '120'],
    });
    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', (u) => this.handleConnectionUpdate(u));
  }

  private handleConnectionUpdate(u: Partial<ConnectionState>): void {
    if (u.qr) {
      this.logger.warn(
        'WA QR available — scan it from WhatsApp → Linked devices → Link a device.',
      );
      qrcode.generate(u.qr, { small: true });
    }
    if (u.connection === 'open') {
      const id = this.sock?.user?.id ?? '';
      const phone = id.split(':')[0]?.split('@')[0] ?? null;
      if (phone) this.state.markConnected(phone);
      this.logger.log(`WA connected (phone=${phone})`);
    }
    if (u.connection === 'close') {
      this.state.markDisconnected();
      const err = u.lastDisconnect?.error as Boom | Error | undefined;
      const code = (err as Boom | undefined)?.output?.statusCode;
      const errMessage = err?.message ?? 'unknown';
      // Loguear SIEMPRE el motivo del close (no solo cuando es loggedOut)
      // para poder diagnosticar conexiones que fallan antes de emitir QR.
      this.logger.warn(
        `WA connection closed — code=${code ?? '?'} message=${errMessage}`,
      );
      if (code === DisconnectReason.loggedOut) {
        this.logger.error(
          'WA loggedOut — re-scan QR after deleting auth dir.',
        );
        return;
      }
      if (this.shuttingDown) return;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const ms = this.state.nextBackoffMs();
    this.logger.warn(`WA reconnect scheduled in ${ms}ms`);
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((err) => {
        this.logger.error(`Reconnect failed: ${(err as Error).message}`);
        this.scheduleReconnect();
      });
    }, ms);
  }

  private redact(digits: string): string {
    return digits.length <= 4 ? '****' : `***${digits.slice(-4)}`;
  }
}

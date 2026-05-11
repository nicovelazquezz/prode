import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ENV_TOKEN, type Env } from '../../config/env.js';
import { BaileysClientService } from '../baileys/baileys.client.service.js';

/**
 * Pingea periódicamente el `/health` del backend principal y manda un
 * WhatsApp al admin cuando lo detecta caído.
 *
 * Diseñado para vivir **afuera del backend principal** (en este
 * sidecar) — si el backend muere completo, Sentry tampoco recibe el
 * evento porque no hay proceso vivo; este watchdog cubre justo ese
 * caso.
 *
 * Estados:
 *   - Health OK (2xx) → reset del contador. Si veníamos de "down",
 *     manda WA "recuperado" y limpia el flag `notified`.
 *   - Health no-2xx o timeout → incrementa contador. Cuando alcanza
 *     el threshold (default 3) y `notified=false`, manda WA "caído"
 *     y setea `notified=true` para no spamear.
 *
 * El healthcheck del backend devuelve 200+degraded cuando Redis cae
 * (deliberado — backend sigue sirviendo lecturas). El watchdog
 * interpreta cualquier 2xx como "vivo" → NO alerta por Redis
 * degradado, solo por DB caída o proceso muerto.
 *
 * Si Baileys no está conectado al momento de mandar, log warn y NO
 * bloquear el watchdog — la próxima alerta volverá a intentar.
 */
@Injectable()
export class WatchdogService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WatchdogService.name);
  private timer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private notified = false;
  private downSince: Date | null = null;

  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly baileys: BaileysClientService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WATCHDOG_ENABLED) {
      this.logger.log('Watchdog deshabilitado (WATCHDOG_ENABLED=false)');
      return;
    }
    if (!this.env.ADMIN_WHATSAPP_NUMBER) {
      // Defensa adicional al cross-field check del env: si por algún
      // motivo llegamos acá sin admin number, no arrancamos el cron.
      this.logger.warn(
        'Watchdog habilitado pero ADMIN_WHATSAPP_NUMBER no está seteado — no arranca',
      );
      return;
    }
    this.logger.log(
      `Watchdog arrancado · pingueo cada ${this.env.WATCHDOG_INTERVAL_MS}ms · threshold ${this.env.WATCHDOG_FAILURE_THRESHOLD} fallas consecutivas`,
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, this.env.WATCHDOG_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('Watchdog detenido');
    }
  }

  /**
   * Una iteración del cron. Público para que los tests puedan
   * invocarlo directamente sin esperar al setInterval.
   */
  async tick(): Promise<void> {
    const ok = await this.probeBackend();
    if (ok) {
      // Recovery: si veníamos de "down" notificado, avisamos que volvió.
      if (this.notified) {
        await this.sendAlert(this.buildRecoveryMessage());
        this.notified = false;
        this.downSince = null;
      }
      this.consecutiveFailures = 0;
      return;
    }

    // Falla: incrementamos contador y, si cruzamos el threshold sin
    // haber notificado todavía, mandamos la alerta.
    this.consecutiveFailures += 1;
    if (
      this.consecutiveFailures >= this.env.WATCHDOG_FAILURE_THRESHOLD &&
      !this.notified
    ) {
      this.downSince = new Date();
      await this.sendAlert(this.buildDownMessage());
      this.notified = true;
    }
  }

  /**
   * fetch al backend con timeout. Devuelve `true` si el response es 2xx,
   * `false` si es no-2xx, timeout, o error de red. No diferencia entre
   * tipos de falla — todas cuentan igual para el contador.
   */
  private async probeBackend(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.env.WATCHDOG_FETCH_TIMEOUT_MS,
    );
    try {
      const response = await fetch(this.env.BACKEND_HEALTH_URL, {
        signal: controller.signal,
      });
      return response.ok;
    } catch (err) {
      this.logger.debug(
        `Probe falló: ${(err as Error).message ?? 'unknown error'}`,
      );
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Best-effort send. Si Baileys no está conectado o tira error, log
   * warn pero no propagamos — el watchdog tiene que seguir vivo.
   */
  private async sendAlert(message: string): Promise<void> {
    const to = this.env.ADMIN_WHATSAPP_NUMBER;
    if (!to) return;
    try {
      await this.baileys.sendText(to, message);
      this.logger.log(`Alerta watchdog enviada al admin`);
    } catch (err) {
      this.logger.warn(
        `No pude enviar alerta watchdog: ${(err as Error).message}. Reintenta en el próximo ciclo si sigue caído.`,
      );
    }
  }

  private buildDownMessage(): string {
    const ts = this.formatArt(new Date());
    return `🚨 Backend caído desde ${ts} (${this.consecutiveFailures} chequeos consecutivos sin respuesta a ${this.env.BACKEND_HEALTH_URL}). Revisá ya.`;
  }

  private buildRecoveryMessage(): string {
    const now = this.formatArt(new Date());
    const since = this.downSince ? this.formatArt(this.downSince) : '?';
    return `✅ Backend recuperado a ${now}. Estuvo caído desde ${since}.`;
  }

  /**
   * Formatea Date en hora ART. El container tiene tzdata instalado
   * y TZ=America/Argentina/Buenos_Aires, así que `toLocaleString`
   * con esa zona explícita funciona; lo dejamos hardcodeado por
   * defensa adicional.
   */
  private formatArt(d: Date): string {
    return d.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
}

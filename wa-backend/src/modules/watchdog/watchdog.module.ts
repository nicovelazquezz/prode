import { Module } from '@nestjs/common';
import { BaileysModule } from '../baileys/baileys.module.js';
import { WatchdogService } from './watchdog.service.js';

/**
 * Watchdog del backend principal. Ver `watchdog.service.ts` para el
 * detalle. Importa BaileysModule para poder mandar WhatsApps de alerta.
 */
@Module({
  imports: [BaileysModule],
  providers: [WatchdogService],
})
export class WatchdogModule {}

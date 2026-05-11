import { Controller, Get, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../../common/auth/bearer.guard.js';
import { BaileysClientService } from '../baileys/baileys.client.service.js';

@Controller()
export class StatusController {
  constructor(private readonly client: BaileysClientService) {}

  @Get('health')
  health(): { ok: true } {
    return { ok: true };
  }

  @Get('status')
  @UseGuards(BearerGuard)
  status(): { connected: boolean; phone: string | null; lastSeenAt: string | null } {
    const snap = this.client.snapshot();
    return {
      connected: snap.connected,
      phone: snap.phone,
      lastSeenAt: snap.lastSeenAt ? snap.lastSeenAt.toISOString() : null,
    };
  }
}

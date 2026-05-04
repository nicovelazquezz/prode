import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service.js';

@Module({
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}

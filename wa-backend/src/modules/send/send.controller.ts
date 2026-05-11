import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../../common/auth/bearer.guard.js';
import { BaileysClientService } from '../baileys/baileys.client.service.js';
import { SendMessageDto } from './dto/send-message.dto.js';

@Controller('send')
@UseGuards(BearerGuard)
export class SendController {
  constructor(private readonly client: BaileysClientService) {}

  @Post()
  @HttpCode(200)
  send(@Body() body: SendMessageDto): Promise<{ messageId: string }> {
    return this.client.sendText(body.to, body.message);
  }
}

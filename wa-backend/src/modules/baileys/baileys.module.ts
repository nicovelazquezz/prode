import { Global, Module } from '@nestjs/common';
import { BaileysClientService } from './baileys.client.service.js';

@Global()
@Module({
  providers: [BaileysClientService],
  exports: [BaileysClientService],
})
export class BaileysModule {}

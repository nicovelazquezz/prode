import { Module } from '@nestjs/common';
import { SendController } from './send.controller.js';

@Module({ controllers: [SendController] })
export class SendModule {}

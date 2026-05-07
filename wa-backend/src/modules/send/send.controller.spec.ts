import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { SendController } from './send.controller.js';
import { BaileysClientService } from '../baileys/baileys.client.service.js';
import { BearerGuard } from '../../common/auth/bearer.guard.js';

describe('SendController', () => {
  let controller: SendController;
  const sendText =
    jest.fn<(to: string, message: string) => Promise<{ messageId: string }>>();

  beforeEach(async () => {
    sendText.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [SendController],
      providers: [{ provide: BaileysClientService, useValue: { sendText } }],
    })
      .overrideGuard(BearerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(SendController);
  });

  it('returns messageId on success', async () => {
    sendText.mockResolvedValue({ messageId: 'WAMID-1' });
    const result = await controller.send({
      to: '+5491166660000',
      message: 'hola',
    });
    expect(result).toEqual({ messageId: 'WAMID-1' });
    expect(sendText).toHaveBeenCalledWith('+5491166660000', 'hola');
  });

  it('propagates ServiceUnavailable when client throws it', async () => {
    sendText.mockRejectedValue(
      new ServiceUnavailableException('WhatsApp not connected'),
    );
    await expect(
      controller.send({ to: '+5491166660000', message: 'hola' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

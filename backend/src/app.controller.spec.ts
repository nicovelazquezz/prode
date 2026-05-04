import { Test } from '@nestjs/testing';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  let controller: AppController;
  beforeEach(async () => {
    const ref = await Test.createTestingModule({ controllers: [AppController] }).compile();
    controller = ref.get(AppController);
  });

  it('GET /health responds 200 with status ok', () => {
    const res = controller.health();
    expect(res.status).toBe('ok');
    expect(typeof res.timestamp).toBe('string');
  });
});

import { jest } from '@jest/globals';
import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import type { AdminAlertsService } from '../../shared/admin-alerts/admin-alerts.service.js';

function makeHost(): { host: ArgumentsHost; res: { status: jest.Mock; json: jest.Mock } } {
  const res = {
    status: jest.fn().mockReturnThis() as unknown as jest.Mock,
    json: jest.fn() as unknown as jest.Mock,
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('GlobalExceptionFilter (5xx fan-out)', () => {
  it('does NOT call AdminAlerts on a 4xx HttpException', () => {
    const notify = jest.fn<AdminAlertsService['notify']>().mockResolvedValue(undefined);
    const adminAlerts = { notify } as unknown as AdminAlertsService;
    const filter = new GlobalExceptionFilter(adminAlerts);
    const { host, res } = makeHost();

    filter.catch(new HttpException('nope', HttpStatus.BAD_REQUEST), host);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(notify).not.toHaveBeenCalled();
  });

  it('calls AdminAlerts.notify on an unhandled exception (500)', () => {
    const notify = jest.fn<AdminAlertsService['notify']>().mockResolvedValue(undefined);
    const adminAlerts = { notify } as unknown as AdminAlertsService;
    const filter = new GlobalExceptionFilter(adminAlerts);
    const { host, res } = makeHost();

    filter.catch(new Error('boom'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BACKEND_ERROR',
        message: expect.stringContaining('HTTP 500'),
      }),
    );
  });

  it('calls AdminAlerts.notify on a 5xx HttpException', () => {
    const notify = jest.fn<AdminAlertsService['notify']>().mockResolvedValue(undefined);
    const adminAlerts = { notify } as unknown as AdminAlertsService;
    const filter = new GlobalExceptionFilter(adminAlerts);
    const { host, res } = makeHost();

    filter.catch(new InternalServerErrorException('upstream down'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('still responds with 500 when AdminAlerts is missing (no DI)', () => {
    const filter = new GlobalExceptionFilter();
    const { host, res } = makeHost();
    filter.catch(new Error('orphan'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
  });
});

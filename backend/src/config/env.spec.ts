import { jest } from '@jest/globals';
import { loadEnv } from './env.js';

const validEnv = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://prode:prode_dev_pwd@localhost:5433/prode',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  MP_ACCESS_TOKEN: 'TEST-token',
  MP_PUBLIC_KEY: 'TEST-pk',
  MP_WEBHOOK_SECRET: 'wh-secret',
  WHATSAPP_API_URL: 'https://example.com',
  WHATSAPP_API_TOKEN: 'tok',
  ADMIN_WHATSAPP_NUMBER: '5492914000000',
  EMAIL_FROM: 'prode@tirofederal.com',
  FRONTEND_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
};

describe('loadEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...validEnv } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('returns parsed Env when all required vars are present and valid', () => {
    const env = loadEnv();
    expect(env.PORT).toBe(3001);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.NODE_ENV).toBe('development');
    expect(env.JWT_ACCESS_SECRET).toHaveLength(40);
  });

  it('calls process.exit(1) when DATABASE_URL is missing', () => {
    delete (process.env as Record<string, string | undefined>).DATABASE_URL;
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => {
        throw new Error('process.exit called');
      }) as never);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => loadEnv()).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
  });
});

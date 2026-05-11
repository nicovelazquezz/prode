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
  EMAIL_FROM: 'noreply@prodeplus.com',
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

  describe('production safety guard', () => {
    function spyOnExit() {
      return jest
        .spyOn(process, 'exit')
        .mockImplementation(((_code?: number) => {
          throw new Error('process.exit called');
        }) as never);
    }

    it('aborts when THROTTLER_BYPASS_TEST is set in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.THROTTLER_BYPASS_TEST = '1';
      const exitSpy = spyOnExit();
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => loadEnv()).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const message = errSpy.mock.calls[0]?.[0] as string;
      expect(message).toMatch(/THROTTLER_BYPASS_TEST/);
    });

    it('aborts when a JWT secret contains the dev sentinel', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_ACCESS_SECRET =
        'dev_only_access_secret_at_least_32_chars_long_xxx';
      const exitSpy = spyOnExit();
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => loadEnv()).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const message = errSpy.mock.calls[0]?.[0] as string;
      expect(message).toMatch(/JWT_ACCESS_SECRET/);
      expect(message).toMatch(/dev_only/);
    });

    it('aborts when ADMIN_DEFAULT_PASSWORD has the ChangeMe sentinel', () => {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_DEFAULT_PASSWORD = 'ChangeMe_DevOnly!';
      const exitSpy = spyOnExit();
      jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => loadEnv()).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does NOT abort when secrets are clean and required prod vars are set', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_ACCESS_SECRET = 'p'.repeat(64);
      process.env.JWT_REFRESH_SECRET = 'q'.repeat(64);
      process.env.MP_WEBHOOK_SECRET = 'wh-prod-real-secret';
      process.env.WHATSAPP_API_TOKEN = 'wa-prod-real-token';
      process.env.TURNSTILE_SECRET_KEY = 'ts-prod-real-secret';
      process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
      process.env.ADMIN_DEFAULT_PASSWORD = 'admin-prod-real-pwd';
      delete (process.env as Record<string, string | undefined>)
        .THROTTLER_BYPASS_TEST;

      const env = loadEnv();
      expect(env.NODE_ENV).toBe('production');
    });

    it('aborts when ADMIN_DEFAULT_PASSWORD is missing in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_ACCESS_SECRET = 'p'.repeat(64);
      process.env.JWT_REFRESH_SECRET = 'q'.repeat(64);
      process.env.MP_WEBHOOK_SECRET = 'wh-prod-real-secret';
      process.env.WHATSAPP_API_TOKEN = 'wa-prod-real-token';
      process.env.TURNSTILE_SECRET_KEY = 'ts-prod-real-secret';
      process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
      delete (process.env as Record<string, string | undefined>)
        .ADMIN_DEFAULT_PASSWORD;
      delete (process.env as Record<string, string | undefined>)
        .THROTTLER_BYPASS_TEST;
      const exitSpy = spyOnExit();
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => loadEnv()).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const message = errSpy.mock.calls[0]?.[0] as string;
      expect(message).toMatch(/ADMIN_DEFAULT_PASSWORD/);
    });

    it('does NOT abort in development even with dev sentinels (intended)', () => {
      process.env.NODE_ENV = 'development';
      process.env.JWT_ACCESS_SECRET =
        'dev_only_access_secret_at_least_32_chars_long_xxx';
      process.env.THROTTLER_BYPASS_TEST = '1';

      const env = loadEnv();
      expect(env.NODE_ENV).toBe('development');
    });
  });
});

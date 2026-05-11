import { describe, it, expect } from '@jest/globals';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  const valid = {
    PORT: '3001',
    WA_API_TOKEN: 'a'.repeat(32),
    WA_AUTH_DIR: './data/auth',
    WA_SEND_DELAY_MS: '500',
    WA_VERIFY_RECIPIENT: 'false',
    WA_RECONNECT_MAX_BACKOFF_MS: '60000',
    LOG_LEVEL: 'info',
  };

  it('parses a valid env into typed values', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3001);
    expect(env.WA_SEND_DELAY_MS).toBe(500);
    expect(env.WA_VERIFY_RECIPIENT).toBe(false);
  });

  it('throws when WA_API_TOKEN is missing', () => {
    const { WA_API_TOKEN: _omit, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(/WA_API_TOKEN/);
  });

  it('throws when WA_API_TOKEN is shorter than 16 chars', () => {
    expect(() => parseEnv({ ...valid, WA_API_TOKEN: 'short' })).toThrow(/WA_API_TOKEN/);
  });

  it('applies defaults for optional vars', () => {
    const minimal = { WA_API_TOKEN: 'a'.repeat(32) };
    const env = parseEnv(minimal);
    expect(env.PORT).toBe(3001);
    expect(env.WA_AUTH_DIR).toBe('./data/auth');
    expect(env.WA_SEND_DELAY_MS).toBe(500);
    expect(env.WA_VERIFY_RECIPIENT).toBe(false);
    expect(env.WA_RECONNECT_MAX_BACKOFF_MS).toBe(60_000);
    expect(env.LOG_LEVEL).toBe('info');
  });
});

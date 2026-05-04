import { AuthService } from './auth.service.js';

describe('AuthService primitives', () => {
  let svc: AuthService;

  beforeAll(() => {
    // Set required env vars before constructing the service. The 32-char
    // minimum mirrors the Zod schema; see `config/env.ts`.
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.MP_ACCESS_TOKEN = 'x';
    process.env.MP_PUBLIC_KEY = 'x';
    process.env.MP_WEBHOOK_SECRET = 'x';
    process.env.WHATSAPP_API_URL = 'https://example.com';
    process.env.WHATSAPP_API_TOKEN = 'x';
    process.env.ADMIN_WHATSAPP_NUMBER = '5491100000000';
    process.env.EMAIL_FROM = 'a@b.com';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.API_URL = 'http://localhost:3001';
    svc = new AuthService();
  });

  describe('hashPassword / comparePassword', () => {
    it('produces a hash that comparePassword accepts', async () => {
      const hash = await svc.hashPassword('Sup3rSecret!');
      expect(hash).not.toBe('Sup3rSecret!');
      await expect(svc.comparePassword('Sup3rSecret!', hash)).resolves.toBe(
        true,
      );
    });

    it('rejects wrong passwords', async () => {
      const hash = await svc.hashPassword('right');
      await expect(svc.comparePassword('wrong', hash)).resolves.toBe(false);
    });
  });

  describe('JWT signing/verification', () => {
    it('round-trips an access token', () => {
      const token = svc.signAccessToken({ sub: 'usr_1', role: 'ADMIN' });
      expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      const decoded = svc.verifyAccessToken(token);
      expect(decoded).toEqual({ sub: 'usr_1', role: 'ADMIN' });
    });

    it('round-trips a refresh token', () => {
      const token = svc.signRefreshToken({ sub: 'usr_2' });
      expect(svc.verifyRefreshToken(token)).toEqual({ sub: 'usr_2' });
    });

    it('returns null for tampered access tokens', () => {
      const token = svc.signAccessToken({ sub: 'usr_1', role: 'USER' });
      const tampered = token.slice(0, -2) + 'aa';
      expect(svc.verifyAccessToken(tampered)).toBeNull();
    });

    it('returns null when verifying an access token with the refresh secret family', () => {
      const refresh = svc.signRefreshToken({ sub: 'usr_1' });
      // Refresh tokens are signed with a different secret AND don't carry `role`,
      // so verifyAccessToken must reject them.
      expect(svc.verifyAccessToken(refresh)).toBeNull();
    });

    it('returns null for malformed tokens', () => {
      expect(svc.verifyAccessToken('not-a-jwt')).toBeNull();
      expect(svc.verifyRefreshToken('also-bogus')).toBeNull();
    });
  });

  describe('generatePlainToken', () => {
    it('returns a 64-character hex string', () => {
      const t = svc.generatePlainToken();
      expect(t).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is non-deterministic', () => {
      const a = svc.generatePlainToken();
      const b = svc.generatePlainToken();
      expect(a).not.toBe(b);
    });
  });

  describe('hashToken', () => {
    it('is deterministic — same input yields same hash', () => {
      const a = svc.hashToken('plain');
      const b = svc.hashToken('plain');
      expect(a).toBe(b);
    });

    it('produces a 64-character sha256 hex digest', () => {
      expect(svc.hashToken('any')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes when the input changes', () => {
      expect(svc.hashToken('a')).not.toBe(svc.hashToken('b'));
    });
  });
});

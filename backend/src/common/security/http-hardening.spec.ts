import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { applyHttpHardening } from './http-hardening.js';
import { loadEnv } from '../../config/env.js';

/**
 * Smoke test for `applyHttpHardening`. Verifies that:
 *   - helmet sets the standard security headers
 *   - CORS only echoes `Access-Control-Allow-Origin` for the configured
 *     `FRONTEND_URL`, and rejects other origins by omitting the header.
 *
 * Both checks use the public `/health` endpoint so we don't need any
 * DB or auth setup.
 */
describe('applyHttpHardening (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    applyHttpHardening(app, loadEnv());
    await app.init();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('helmet sets the canonical security headers on /health', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    // helmet defaults — these are the ones we rely on for the API.
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    // helmet sets `Strict-Transport-Security` even outside HTTPS — keeps
    // production deploys behind a TLS terminator working out of the box.
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
  });

  it('CORS echoes the configured origin and skips other origins', async () => {
    const env = loadEnv();
    const okRes = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', env.FRONTEND_URL);
    expect(okRes.headers['access-control-allow-origin']).toBe(env.FRONTEND_URL);

    const blockedRes = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://malicious.example.com');
    // Express/CORS omits the header when the origin doesn't match. The
    // browser refuses the response client-side; the server still
    // returns 200 since CORS is purely a browser-enforced contract.
    expect(blockedRes.headers['access-control-allow-origin']).toBeUndefined();
  });
});

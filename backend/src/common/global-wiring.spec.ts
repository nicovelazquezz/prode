import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../app.module.js';

/**
 * E2E smoke test for the global wiring set up in `AppModule`:
 *   - ValidationPipe rejects malformed bodies with 400 + details
 *   - JwtAuthGuard rejects unauthenticated requests to non-@Public()
 *     endpoints with 401
 *   - @Public() endpoints (/health, /auth/login) pass through guard
 */
describe('Global wiring (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns 400 with field-level details on a malformed login body', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: 'abc', password: '' });

    expect(res.status).toBe(400);
    // ValidationPipe writes either { message: string[] } directly, or
    // wraps it under `response`. Flatten both shapes for assertions.
    const collected: string[] = [];
    const visit = (v: unknown) => {
      if (typeof v === 'string') collected.push(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(res.body);
    expect(
      collected.some((m) => m.toLowerCase().includes('dni')),
    ).toBe(true);
  });

  it('returns 400 when an unknown property is sent (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        dni: '00000000',
        password: 'whatever',
        unexpectedField: 'should reject',
      });

    expect(res.status).toBe(400);
  });

  it('returns 401 on a non-@Public() endpoint without a Bearer token', async () => {
    // /auth/logout has no @Public() so the global JwtAuthGuard must reject.
    const res = await request(app.getHttpServer()).post('/auth/logout');
    expect(res.status).toBe(401);
  });

  it('lets @Public() endpoints through (GET /health responds without auth)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    // health is a @Public() endpoint; should succeed.
    expect(res.status).toBe(200);
  });
});

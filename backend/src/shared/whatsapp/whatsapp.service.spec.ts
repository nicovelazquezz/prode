import { jest } from '@jest/globals';
import { WhatsappService } from './whatsapp.service.js';

function makeResponse(status: number, body = ''): Response {
  return new Response(body, { status });
}

describe('WhatsappService', () => {
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_URL = process.env.WHATSAPP_API_URL;
  // Real-mode tests need a non-placeholder URL so the dev-simulate
  // shortcut doesn't kick in. The project .env has example.com which
  // triggers simulate mode; we override per-test.
  const REAL_URL = 'https://wa.prodeplus.com';
  const expectedAuth = 'Bearer dev-token';

  beforeEach(() => {
    process.env.WHATSAPP_API_URL = REAL_URL;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
    process.env.WHATSAPP_API_URL = ORIGINAL_URL;
  });

  it('POSTs to {WHATSAPP_API_URL}/send with Bearer auth and JSON body', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(makeResponse(200, 'ok'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new WhatsappService();
    await svc.send('5491111111111', 'hola');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${REAL_URL}/send`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(expectedAuth);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      to: '5491111111111',
      message: 'hola',
    });
  });

  it('strips a trailing slash from WHATSAPP_API_URL when composing /send', async () => {
    process.env.WHATSAPP_API_URL = `${REAL_URL}/`;
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(makeResponse(200));
    global.fetch = fetchMock as unknown as typeof fetch;
    const svc = new WhatsappService();
    await svc.send('5491111111111', 'x');
    expect(fetchMock.mock.calls[0][0]).toBe(`${REAL_URL}/send`);
  });

  it('throws when the upstream returns a non-2xx response', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(makeResponse(503, 'unavailable'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new WhatsappService();
    await expect(svc.send('5491111111111', 'hola')).rejects.toThrow(/503/);
  });

  it('propagates network-level errors (so BullMQ retries kick in)', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('ECONNRESET'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new WhatsappService();
    await expect(svc.send('5491111111111', 'hola')).rejects.toThrow(
      'ECONNRESET',
    );
  });

  describe('dev-simulate mode (placeholder URLs)', () => {
    const PLACEHOLDERS = [
      'https://example.com',
      'http://example.com',
      'https://example.org',
      'http://localhost:9999',
      'http://127.0.0.1:9999',
    ];

    PLACEHOLDERS.forEach((url) => {
      it(`skips fetch and resolves OK when URL is ${url}`, async () => {
        process.env.WHATSAPP_API_URL = url;
        const fetchMock = jest.fn<typeof fetch>();
        global.fetch = fetchMock as unknown as typeof fetch;

        const svc = new WhatsappService();
        await expect(svc.send('5491111111111', 'hola')).resolves.toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });
  });
});

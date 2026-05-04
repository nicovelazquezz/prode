import { jest } from '@jest/globals';
import { WhatsappService } from './whatsapp.service.js';

function makeResponse(status: number, body = ''): Response {
  return new Response(body, { status });
}

describe('WhatsappService', () => {
  const ORIGINAL_FETCH = global.fetch;
  // Tests assume these env values; jest.setup.js loads the project .env which
  // sets WHATSAPP_API_URL=https://example.com and WHATSAPP_API_TOKEN=dev-token.
  const expectedUrl = 'https://example.com/send';
  const expectedAuth = 'Bearer dev-token';

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
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
    expect(url).toBe(expectedUrl);
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
    const original = process.env.WHATSAPP_API_URL;
    process.env.WHATSAPP_API_URL = 'https://example.com/';
    try {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(makeResponse(200));
      global.fetch = fetchMock as unknown as typeof fetch;
      const svc = new WhatsappService();
      await svc.send('5491111111111', 'x');
      expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/send');
    } finally {
      process.env.WHATSAPP_API_URL = original;
    }
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
});

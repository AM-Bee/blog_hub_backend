import { ExpoPushClient, ExpoPushError } from './expo-push.client.js';
import type { ChatPushPayload } from './expo-push.client.js';

const payload: ChatPushPayload = {
  to: 'ExpoPushToken[test_device]',
  title: 'BlogHub',
  body: 'New message from Alice',
  sound: 'default',
  ttl: 3600,
  tag: 'message',
  collapseId: 'message',
  data: {
    type: 'chat_message',
    conversationId: 'conversation',
    messageId: 'message',
  },
};
describe('Expo push transport (mocked only)', () => {
  const client = new ExpoPushClient();
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('sends a visible privacy-safe notification and a server-side access token', async () => {
    vi.stubEnv('EXPO_ACCESS_TOKEN', 'server-secret');
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: [{ status: 'ok', id: 'ticket' }] }),
      );
    vi.stubGlobal('fetch', fetch);
    expect(await client.send(payload)).toEqual({ status: 'ok', id: 'ticket' });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(options.body)).toEqual([payload]);
    expect(options.headers.Authorization).toBe('Bearer server-secret');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.redirect).toBe('error');
  });
  it('looks up receipts, treating absent IDs as pending', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: {} }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            ticket: {
              status: 'error',
              details: { error: 'DeviceNotRegistered' },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    expect(await client.receipt('ticket')).toBeNull();
    expect(await client.receipt('ticket')).toMatchObject({
      details: { error: 'DeviceNotRegistered' },
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      ids: ['ticket'],
    });
  });
  it.each([
    [429, true],
    [503, true],
    [400, false],
    [401, false],
  ])('classifies HTTP %i', async (status, retryable) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status })),
    );
    await expect(client.send(payload)).rejects.toMatchObject({
      code: `expo_http_${status}`,
      retryable,
    });
  });
  it.each([
    {},
    { data: [] },
    { data: [{ status: 'ok' }] },
    { data: [{ status: 'nonsense' }] },
  ])('rejects malformed tickets %j', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response)));
    await expect(client.send(payload)).rejects.toBeInstanceOf(ExpoPushError);
  });
  it('bounds network failures and rejects malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(client.send(payload)).rejects.toMatchObject({
      code: 'expo_network_error',
      retryable: true,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json')));
    await expect(client.send(payload)).rejects.toMatchObject({
      code: 'invalid_expo_json',
    });
  });
  it('does not retry authentication errors returned by Expo', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ errors: [{ code: 'UNAUTHORIZED' }] }),
        ),
    );
    await expect(client.send(payload)).rejects.toMatchObject({
      retryable: false,
    });
  });
});

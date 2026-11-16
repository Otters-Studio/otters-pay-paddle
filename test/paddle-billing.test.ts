import { describe, expect, it, vi } from 'vitest';
import { PaddleBilling, PaddleBillingError, signPaddlePayload } from '../src';

const SECRET = 'pdl_ntfset_01test_secret';
const NOW = 1_763_251_200;
const PADDLE_IP = '34.232.58.13';

const fakeFetch: typeof fetch = (input) => {
  const url = String(input);
  if (url.endsWith('/ips')) return Promise.resolve(Response.json({ data: { ipv4_cidrs: [`${PADDLE_IP}/32`] } }));
  return Promise.resolve(Response.json({ error: { code: 'not_found' } }, { status: 404 }));
};

function paddle(overrides: Partial<ConstructorParameters<typeof PaddleBilling>[0]> = {}) {
  return new PaddleBilling({
    environment: 'sandbox',
    apiKey: 'pdl_sdbx_apikey_x',
    clientToken: 'test_token',
    webhookSecret: SECRET,
    apiBaseUrl: 'https://paddle.test',
    fetch: fakeFetch,
    nowSeconds: () => NOW,
    ...overrides,
  });
}

const body = Buffer.from(JSON.stringify({ event_id: 'evt_1', event_type: 'customer.created', occurred_at: '2026-11-16T10:00:00Z', data: {} }));
const signed = { 'paddle-signature': `ts=${NOW};h1=${signPaddlePayload(SECRET, NOW, body)}` };

async function rejection(promise: Promise<unknown>): Promise<PaddleBillingError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(PaddleBillingError);
  return error as PaddleBillingError;
}

describe('PaddleBilling', () => {
  it('builds a browser-safe checkout config', () => {
    expect(paddle().checkoutConfig({ priceId: 'pri_1', userId: 'u1', email: null, customerId: null })).toEqual({
      provider: 'paddle',
      environment: 'sandbox',
      clientToken: 'test_token',
      priceId: 'pri_1',
      customerId: null,
      email: null,
      userId: 'u1',
    });
  });

  it('accepts a signed webhook from a Paddle IP', async () => {
    const event = await paddle().parseWebhook({ rawBody: body, headers: signed, ip: `::ffff:${PADDLE_IP}` });
    expect(event).toMatchObject({ kind: 'ignored', eventId: 'evt_1' });
  });

  it('rejects other IPs, bad signatures and unparseable bodies', async () => {
    expect((await rejection(paddle().parseWebhook({ rawBody: body, headers: signed, ip: '1.1.1.1' }))).status).toBe(403);
    expect((await rejection(paddle().parseWebhook({ rawBody: body, headers: {}, ip: PADDLE_IP }))).status).toBe(401);
    const junk = Buffer.from('nope');
    const junkHeaders = { 'paddle-signature': `ts=${NOW};h1=${signPaddlePayload(SECRET, NOW, junk)}` };
    expect((await rejection(paddle().parseWebhook({ rawBody: junk, headers: junkHeaders, ip: PADDLE_IP }))).code).toBe('BILLING_WEBHOOK_MALFORMED');
  });

  it('answers 503 while the IP list cannot be loaded, unless IP checks are off', async () => {
    const down: typeof fetch = () => Promise.reject(new Error('down'));
    expect((await rejection(paddle({ fetch: down }).parseWebhook({ rawBody: body, headers: signed, ip: PADDLE_IP }))).status).toBe(503);
    await expect(paddle({ fetch: down, verifyWebhookIp: false }).parseWebhook({ rawBody: body, headers: signed, ip: undefined })).resolves.toMatchObject({ kind: 'ignored' });
  });

  it('requires the raw body bytes', async () => {
    const parsed = JSON.parse(body.toString()) as unknown as Buffer;
    expect((await rejection(paddle().parseWebhook({ rawBody: parsed, headers: signed, ip: PADDLE_IP }))).code).toBe('BILLING_CONFIG_INVALID');
  });

  it('turns API errors into a 502', async () => {
    expect((await rejection(paddle().cancelSubscriptionNow('sub_1'))).status).toBe(502);
  });
});

describe('PaddleBilling API key problems', () => {
  function withStatus(status: number) {
    const error = vi.fn();
    const failing: typeof fetch = (input) =>
      String(input).endsWith('/ips')
        ? fakeFetch(input)
        : Promise.resolve(Response.json({ error: { code: status === 401 ? 'authentication_malformed' : 'forbidden', detail: 'nope' } }, { status }));
    return { error, billing: paddle({ fetch: failing, logger: { info: vi.fn(), warn: vi.fn(), error } }) };
  }

  it('logs an expired or revoked key as an error', async () => {
    const { error, billing } = withStatus(401);
    await rejection(billing.createPortalSession('ctm_1', null));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }), expect.stringMatching(/expired, revoked/));
  });

  it('logs the missing permission', async () => {
    const { error, billing } = withStatus(403);
    await rejection(billing.cancelSubscriptionNow('sub_1'));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ requiredPermission: 'subscription.write' }), expect.stringMatching(/subscription\.write/));
  });
});

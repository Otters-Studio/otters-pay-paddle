# otters-pay-paddle

Paddle Billing for Node servers, extracted from Otters Studio products.

- Verifies webhooks: `Paddle-Signature` HMAC (with replay window and secret rotation) **and** Paddle's published sender IPs (fetched from the API, cached, fails closed).
- Turns `subscription.*`, `transaction.completed` and refund/chargeback `adjustment.*` events into small, typed snapshots.
- Builds the browser-safe config for Paddle.js checkout.
- Creates customer portal links and cancels subscriptions.

It does **not** touch your database. You store subscriptions however you like; the package hands you clean events.

```bash
npm install otters-pay-paddle
```

Node 20.19+. Ships ESM and CommonJS with types.

## Setup

```ts
import { PaddleBilling } from 'otters-pay-paddle';

export const paddle = new PaddleBilling({
  environment: 'production',            // or 'sandbox'
  apiKey: process.env.PADDLE_API_KEY!,  // pdl_live_… (server only)
  clientToken: process.env.PADDLE_CLIENT_TOKEN!, // live_… (public)
  webhookSecret: process.env.PADDLE_WEBHOOK_SECRET!,
  logger,                               // optional, pino-style
});
```

### Fails fast on unsafe configuration

The constructor throws `PaddleBillingError` (`BILLING_CONFIG_INVALID`) at startup instead of running half-protected:

- `apiKey` must be `pdl_sdbx_…` in sandbox and `pdl_live_…` in production; a key from the other environment is always rejected. Keys from before Paddle added prefixes need `allowLegacyApiKey: true`.
- `clientToken` must be `test_…` in sandbox and `live_…` in production.
- `webhookSecret` must be at least 16 characters, without whitespace, and not a copy of the API key or token.
- `apiBaseUrl` cannot be overridden in production, so the API key only ever goes to `api.paddle.com`. In sandbox it must be https, or http on localhost.
- Error messages name the setting, never its value.

At runtime, a webhook whose `rawBody` is not a `Buffer` (a JSON parser ran first) answers 500, so Paddle retries after you fix the route instead of the event being lost.

One Paddle account can sell several products: create one `PaddleBilling` per account and tell products apart by price id or by `custom_data`.

## Checkout

```ts
app.get('/billing/checkout', (req, res) => {
  res.json(paddle.checkoutConfig({ priceId: 'pri_…', userId: req.user.id, email: req.user.email, customerId: null }));
});
```

In the browser, open Paddle.js with `customData: { userId }` so every webhook carries your user id back.

## Webhooks

The signature covers the raw bytes, so the route needs a raw body parser.

```ts
import express from 'express';
import { PaddleBillingError } from 'otters-pay-paddle';

app.post('/billing/webhooks/paddle', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const event = await paddle.parseWebhook({ rawBody: req.body, headers: req.headers, ip: req.ip });
    // Deduplicate on event.eventId (Paddle retries), then:
    switch (event.kind) {
      case 'subscription': /* upsert event.subscription */ break;
      case 'payment':      /* renewal or first charge  */ break;
      case 'refund':       /* event.refund.full → revoke access */ break;
    }
    res.sendStatus(200);
  } catch (error) {
    if (error instanceof PaddleBillingError) return res.status(error.status).json({ code: error.code });
    throw error;
  }
});
```

Behind a reverse proxy, set Express `trust proxy` so `req.ip` is the real client. If your proxy hides client IPs, pass `verifyWebhookIp: false` (the signature is still checked).

`userId` on events comes from the browser. Treat it as a hint: prefer an existing link by subscription or customer id, and only accept a `userId` that exists in your database.

## Access

```ts
import { isEntitled, pickPriceId } from 'otters-pay-paddle';

isEntitled({ status: account.status, accessRevoked: account.refunded }); // active | trialing | past_due
pickPriceId(event.subscription.priceIds, ['pri_pro', 'pri_team']);
```

## Portal and cancel

```ts
const links = await paddle.createPortalSession(customerId, subscriptionId); // overviewUrl, cancelUrl, updatePaymentMethodUrl
await paddle.cancelSubscriptionNow(subscriptionId);
```

## Errors

Everything thrown on purpose is a `PaddleBillingError` with an HTTP `status` and a `code`:

| code | status | meaning |
|---|---|---|
| `BILLING_WEBHOOK_UNAVAILABLE` | 503 | Paddle's IP list could not be loaded yet; Paddle will retry |
| `BILLING_WEBHOOK_FORBIDDEN` | 403 | Sender is not a Paddle IP |
| `BILLING_WEBHOOK_SIGNATURE_INVALID` | 401 | Missing, stale or wrong signature |
| `BILLING_WEBHOOK_MALFORMED` | 400 | Signed but not a payload we understand |
| `BILLING_UPSTREAM_FAILED` | 502 | Paddle API unreachable or rejected the call |

## License

MIT

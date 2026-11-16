import { z } from 'zod';
import { PaddleBillingError } from './errors';
import type { Logger, PortalLinks } from './types';

const portalSchema = z.object({
  data: z.object({
    urls: z.object({
      general: z.object({ overview: z.url() }),
      subscriptions: z
        .array(z.object({ id: z.string(), cancel_subscription: z.url(), update_subscription_payment_method: z.url() }))
        .default([]),
    }),
  }),
});

const errorSchema = z.object({ error: z.object({ code: z.string(), detail: z.string().optional() }) });

function upstreamError(message: string): PaddleBillingError {
  return new PaddleBillingError(502, 'BILLING_UPSTREAM_FAILED', message);
}

/** Minimal Paddle Billing API client (server-side only; the API key never leaves this process). */
export class PaddleApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Customer portal session: authenticated links to manage the subscription and payment method. */
  async createPortalSession(customerId: string, subscriptionId: string | null): Promise<PortalLinks> {
    const body = subscriptionId ? { subscription_ids: [subscriptionId] } : {};
    const json = await this.post(`/customers/${encodeURIComponent(customerId)}/portal-sessions`, body, 'customer_portal_session.write');
    const urls = portalSchema.parse(json).data.urls;
    const subscription = urls.subscriptions.find((entry) => entry.id === subscriptionId) ?? null;
    return {
      overviewUrl: urls.general.overview,
      cancelUrl: subscription?.cancel_subscription ?? null,
      updatePaymentMethodUrl: subscription?.update_subscription_payment_method ?? null,
    };
  }

  async cancelSubscriptionNow(subscriptionId: string): Promise<void> {
    await this.post(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { effective_from: 'immediately' }, 'subscription.write');
  }

  /** `permission`: the API key permission this call needs, named in the log when Paddle refuses it. */
  private async post(path: string, body: unknown, permission: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.warn({ err: error, path }, 'Paddle API request failed');
      throw upstreamError('Payment provider is unreachable');
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorSchema.safeParse(json);
      const details = { path, status: response.status, paddleError: parsed.success ? parsed.data.error.code : null, paddleDetail: parsed.success ? (parsed.data.error.detail ?? null) : null };
      if (response.status === 401) {
        this.logger.error(details, 'Paddle rejected the API key (expired, revoked or from the other environment): create a new key in Paddle and update the server secret');
      } else if (response.status === 403) {
        this.logger.error({ ...details, requiredPermission: permission }, `Paddle API key lacks the ${permission} permission: grant it in Paddle (Developer tools → Authentication)`);
      } else {
        this.logger.warn(details, 'Paddle API error');
      }
      throw upstreamError('Payment provider rejected the request');
    }
    return json;
  }
}

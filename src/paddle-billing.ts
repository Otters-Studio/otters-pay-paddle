import { ZodError } from 'zod';
import { PaddleApiClient } from './api-client';
import { validateCredentials } from './config';
import { PaddleBillingError } from './errors';
import { mapPaddleEvent } from './event-mapper';
import { PaddleIpAllowlist } from './ip-allowlist';
import { verifyPaddleSignature } from './signature';
import type { CheckoutContext, Logger, PaddleCheckoutConfig, PaddleEnvironment, PaddleWebhookEvent, PortalLinks, WebhookRequest } from './types';

export interface PaddleBillingOptions {
  environment: PaddleEnvironment;
  /** Server-side API key (pdl_sdbx_… / pdl_live_…). Never sent to the browser. */
  apiKey: string;
  /** Client-side token (test_… / live_…) for Paddle.js. Public by design. */
  clientToken: string;
  /** Endpoint secret key of your notification destination (verifies `Paddle-Signature`). */
  webhookSecret: string;
  /**
   * Overrides the API base URL (tests, mocks). Sandbox only: https, or http on localhost.
   * Production always talks to api.paddle.com.
   */
  apiBaseUrl?: string;
  /** Accept an API key without the `pdl_sdbx_`/`pdl_live_` prefix (keys created before Paddle added prefixes). Default false. */
  allowLegacyApiKey?: boolean;
  /**
   * Check that webhooks come from Paddle's published IPs. Default true. Turn off only behind a proxy that hides
   * client IPs; the signature is still verified, and a warning is logged at startup in production.
   */
  verifyWebhookIp?: boolean;
  logger?: Logger;
  fetch?: typeof fetch;
  /** Current time in seconds (tests). */
  nowSeconds?: () => number;
}

const noopLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Paddle Billing for one Paddle account (one environment). Create it once at startup and share it. */
export class PaddleBilling {
  readonly environment: PaddleEnvironment;
  readonly ipAllowlist: PaddleIpAllowlist;
  private readonly api: PaddleApiClient;
  private readonly logger: Logger;
  private readonly nowSeconds: () => number;

  constructor(private readonly options: PaddleBillingOptions) {
    const baseUrl = validateCredentials(options);
    const fetchImpl = options.fetch ?? fetch;
    this.environment = options.environment;
    this.logger = options.logger ?? noopLogger;
    if (options.verifyWebhookIp === false && options.environment === 'production') {
      this.logger.warn({}, 'Paddle webhook IP check is off in production; only the signature protects the webhook');
    }
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.ipAllowlist = new PaddleIpAllowlist(`${baseUrl}/ips`, this.logger, fetchImpl);
    this.api = new PaddleApiClient(baseUrl, options.apiKey, this.logger, fetchImpl);
  }

  /** Settings for Paddle.js `Checkout.open`; pass `userId` back as `customData.userId`. Contains no secrets. */
  checkoutConfig(context: CheckoutContext): PaddleCheckoutConfig {
    return {
      provider: 'paddle',
      environment: this.options.environment,
      clientToken: this.options.clientToken,
      priceId: context.priceId,
      customerId: context.customerId,
      email: context.email,
      userId: context.userId,
    };
  }

  /**
   * Authenticates a webhook delivery (sender IP, then signature) and parses it.
   * Throws PaddleBillingError: answer with its `status` so Paddle retries what should be retried.
   */
  async parseWebhook(request: WebhookRequest): Promise<PaddleWebhookEvent> {
    if (!Buffer.isBuffer(request.rawBody)) {
      // A parsed JSON body cannot be verified; 500 makes Paddle retry once the route is fixed, so no event is lost.
      throw new PaddleBillingError(500, 'BILLING_CONFIG_INVALID', 'otters-pay-paddle: rawBody must be the raw request bytes (Buffer); use a raw body parser on the webhook route');
    }
    if (!request.headers || typeof request.headers !== 'object') {
      throw new PaddleBillingError(500, 'BILLING_CONFIG_INVALID', 'otters-pay-paddle: headers are required');
    }
    if (this.options.verifyWebhookIp !== false) {
      const allowed = await this.ipAllowlist.isAllowed(request.ip);
      if (allowed === null) throw new PaddleBillingError(503, 'BILLING_WEBHOOK_UNAVAILABLE', 'Webhook sender list unavailable');
      if (!allowed) {
        this.logger.warn({ ip: request.ip }, 'Rejected Paddle webhook from a non-Paddle IP');
        throw new PaddleBillingError(403, 'BILLING_WEBHOOK_FORBIDDEN', 'Sender not allowed');
      }
    }
    const check = verifyPaddleSignature({
      header: headerValue(request.headers['paddle-signature']),
      rawBody: request.rawBody,
      secret: this.options.webhookSecret,
      nowSeconds: this.nowSeconds(),
    });
    if (check !== 'valid') {
      this.logger.warn({ ip: request.ip, check }, 'Rejected Paddle webhook with an invalid signature');
      throw new PaddleBillingError(401, 'BILLING_WEBHOOK_SIGNATURE_INVALID', 'Invalid signature');
    }
    try {
      return mapPaddleEvent(JSON.parse(request.rawBody.toString('utf8')));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof ZodError) {
        this.logger.warn({ err: error }, 'Paddle webhook body could not be parsed');
        throw new PaddleBillingError(400, 'BILLING_WEBHOOK_MALFORMED', 'Unexpected webhook payload');
      }
      throw error;
    }
  }

  createPortalSession(customerId: string, subscriptionId: string | null): Promise<PortalLinks> {
    return this.api.createPortalSession(customerId, subscriptionId);
  }

  /** Ends a subscription immediately (e.g. after a full refund). */
  cancelSubscriptionNow(subscriptionId: string): Promise<void> {
    return this.api.cancelSubscriptionNow(subscriptionId);
  }
}

/** Paddle Billing subscription statuses. */
export const SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'paused', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type PaddleEnvironment = 'sandbox' | 'production';

/** Anything with pino-style `(object, message)` methods; pino and most loggers fit. */
export interface Logger {
  info(object: object, message: string): void;
  warn(object: object, message: string): void;
  error(object: object, message: string): void;
}

/** A subscription as carried by a `subscription.*` webhook. */
export interface SubscriptionSnapshot {
  customerId: string;
  subscriptionId: string;
  status: SubscriptionStatus;
  priceIds: string[];
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** `custom_data.userId` from the checkout. Comes from the browser: untrusted until matched to one of your users. */
  userId: string | null;
  customData: Record<string, unknown> | null;
}

/** A completed transaction (first charge or renewal). */
export interface PaymentSnapshot {
  customerId: string;
  subscriptionId: string | null;
  priceIds: string[];
  periodEnd: Date | null;
  userId: string | null;
  customData: Record<string, unknown> | null;
}

/** An approved refund or chargeback adjustment. */
export interface RefundSnapshot {
  customerId: string;
  subscriptionId: string | null;
  /** Full refunds and chargebacks; partial (goodwill) refunds are `false`. */
  full: boolean;
}

interface EventBase {
  eventId: string;
  eventType: string;
  occurredAt: Date;
}

export type PaddleWebhookEvent = EventBase &
  (
    | { kind: 'subscription'; subscription: SubscriptionSnapshot }
    | { kind: 'payment'; payment: PaymentSnapshot }
    | { kind: 'refund'; refund: RefundSnapshot }
    | { kind: 'ignored' }
  );

export interface WebhookRequest {
  /** The exact bytes Paddle sent (use a raw body parser on the webhook route). */
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  /** Client IP as resolved by your server (behind a proxy, configure it to trust the proxy). */
  ip: string | undefined;
}

export interface CheckoutContext {
  /** Price to sell (pri_…). */
  priceId: string;
  /** Your user id; Paddle.js sends it back as `custom_data.userId` on every event. */
  userId: string;
  email: string | null;
  /** Paddle customer id (ctm_…) when the user already has one. */
  customerId: string | null;
}

/** Everything the browser needs to open Paddle.js checkout. The client token is public by design. */
export interface PaddleCheckoutConfig {
  provider: 'paddle';
  environment: PaddleEnvironment;
  clientToken: string;
  priceId: string;
  customerId: string | null;
  email: string | null;
  userId: string;
}

/** Short-lived customer portal links (open them right away). */
export interface PortalLinks {
  overviewUrl: string;
  cancelUrl: string | null;
  updatePaymentMethodUrl: string | null;
}

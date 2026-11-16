import { z } from 'zod';
import { SUBSCRIPTION_STATUSES, type PaddleWebhookEvent } from './types';

const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const customData = z
  .unknown()
  .transform((value) => {
    const parsed = z.record(z.string(), z.unknown()).safeParse(value);
    return parsed.success ? parsed.data : null;
  });
const item = z.object({ price_id: z.string().optional(), price: z.object({ id: z.string() }).nullish() });
const priceIds = z.array(item).transform((items) => items.map((entry) => entry.price?.id ?? entry.price_id).filter((id): id is string => !!id));
const period = z.object({ starts_at: timestamp, ends_at: timestamp }).nullish();

const envelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: timestamp,
  data: z.unknown(),
});

const subscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(SUBSCRIPTION_STATUSES),
  customer_id: z.string().min(1),
  items: priceIds,
  current_billing_period: period,
  scheduled_change: z.object({ action: z.string() }).nullish(),
  custom_data: customData,
});

const transactionSchema = z.object({
  customer_id: z.string().min(1),
  subscription_id: z.string().nullish(),
  items: priceIds,
  billing_period: period,
  custom_data: customData,
});

const adjustmentSchema = z.object({
  action: z.string(),
  type: z.string().nullish(),
  status: z.string(),
  customer_id: z.string().min(1),
  subscription_id: z.string().nullish(),
});

const REVOKING_ADJUSTMENTS = new Set(['refund', 'chargeback']);

/** `custom_data.userId` when it is a plain, reasonably short string. Still untrusted. */
function userIdFrom(data: Record<string, unknown> | null): string | null {
  const value = data?.userId;
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

/** Parses a verified Paddle webhook body into a provider-neutral event. Throws ZodError on unexpected shapes. */
export function mapPaddleEvent(body: unknown): PaddleWebhookEvent {
  const envelope = envelopeSchema.parse(body);
  const base = { eventId: envelope.event_id, eventType: envelope.event_type, occurredAt: envelope.occurred_at };
  const type = envelope.event_type;

  if (type.startsWith('subscription.')) {
    const data = subscriptionSchema.parse(envelope.data);
    return {
      ...base,
      kind: 'subscription',
      subscription: {
        customerId: data.customer_id,
        subscriptionId: data.id,
        status: data.status,
        priceIds: data.items,
        currentPeriodEnd: data.current_billing_period?.ends_at ?? null,
        cancelAtPeriodEnd: data.scheduled_change?.action === 'cancel',
        userId: userIdFrom(data.custom_data),
        customData: data.custom_data,
      },
    };
  }
  if (type === 'transaction.completed') {
    const data = transactionSchema.parse(envelope.data);
    return {
      ...base,
      kind: 'payment',
      payment: {
        customerId: data.customer_id,
        subscriptionId: data.subscription_id ?? null,
        priceIds: data.items,
        periodEnd: data.billing_period?.ends_at ?? null,
        userId: userIdFrom(data.custom_data),
        customData: data.custom_data,
      },
    };
  }
  if (type === 'adjustment.created' || type === 'adjustment.updated') {
    const data = adjustmentSchema.parse(envelope.data);
    if (data.status === 'approved' && REVOKING_ADJUSTMENTS.has(data.action)) {
      return {
        ...base,
        kind: 'refund',
        refund: { customerId: data.customer_id, subscriptionId: data.subscription_id ?? null, full: data.type === 'full' },
      };
    }
  }
  return { ...base, kind: 'ignored' };
}

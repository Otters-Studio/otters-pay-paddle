import type { SubscriptionStatus } from './types';

/** Statuses in which a subscription still grants access. `past_due` keeps access while Paddle retries the payment. */
export const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(['active', 'trialing', 'past_due']);

export interface EntitlementInput {
  status: SubscriptionStatus | null;
  /** Set after a full refund or chargeback: no access, whatever later events say. */
  accessRevoked: boolean;
}

/**
 * Whether a subscription grants access right now. A cancellation scheduled for the period end keeps access
 * until Paddle sends `subscription.canceled` at that moment.
 */
export function isEntitled(input: EntitlementInput): boolean {
  return !input.accessRevoked && input.status !== null && ENTITLED_STATUSES.has(input.status);
}

/** The first of `wanted` among a subscription's prices, else its first price (kept for diagnostics). */
export function pickPriceId(priceIds: readonly string[], wanted: readonly string[] | string): string | null {
  const list = typeof wanted === 'string' ? [wanted] : wanted;
  return list.find((id) => priceIds.includes(id)) ?? priceIds[0] ?? null;
}

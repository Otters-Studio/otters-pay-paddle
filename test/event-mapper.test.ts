import { describe, expect, it } from 'vitest';
import { mapPaddleEvent } from '../src';

const envelope = (event_type: string, data: unknown) => ({ event_id: 'evt_1', event_type, occurred_at: '2026-11-16T10:00:00.000Z', data });

describe('mapPaddleEvent', () => {
  it('maps a subscription with custom data and a scheduled cancel', () => {
    const event = mapPaddleEvent(
      envelope('subscription.updated', {
        id: 'sub_1',
        status: 'active',
        customer_id: 'ctm_1',
        items: [{ price: { id: 'pri_pro' } }],
        current_billing_period: { starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' },
        scheduled_change: { action: 'cancel' },
        custom_data: { userId: 'u_42', project: 'live' },
      }),
    );
    expect(event.kind).toBe('subscription');
    if (event.kind !== 'subscription') return;
    expect(event.subscription).toMatchObject({
      subscriptionId: 'sub_1',
      customerId: 'ctm_1',
      priceIds: ['pri_pro'],
      cancelAtPeriodEnd: true,
      userId: 'u_42',
      customData: { userId: 'u_42', project: 'live' },
    });
    expect(event.subscription.currentPeriodEnd?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('ignores a non-string userId', () => {
    const event = mapPaddleEvent(
      envelope('transaction.completed', { customer_id: 'ctm_1', subscription_id: 'sub_1', items: [{ price_id: 'pri_pro' }], custom_data: { userId: 5 } }),
    );
    expect(event.kind === 'payment' && event.payment.userId).toBeNull();
  });

  it('maps approved full refunds and chargebacks, and ignores the rest', () => {
    const refund = mapPaddleEvent(envelope('adjustment.updated', { action: 'refund', type: 'full', status: 'approved', customer_id: 'ctm_1', subscription_id: 'sub_1' }));
    expect(refund).toMatchObject({ kind: 'refund', refund: { full: true, subscriptionId: 'sub_1' } });
    const pending = mapPaddleEvent(envelope('adjustment.created', { action: 'refund', type: 'full', status: 'pending_approval', customer_id: 'ctm_1' }));
    expect(pending.kind).toBe('ignored');
    expect(mapPaddleEvent(envelope('customer.created', {})).kind).toBe('ignored');
  });
});

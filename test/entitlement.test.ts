import { describe, expect, it } from 'vitest';
import { isEntitled, pickPriceId } from '../src';

describe('isEntitled', () => {
  it('grants access while active, trialing or past due, and never after a revoke', () => {
    expect(isEntitled({ status: 'active', accessRevoked: false })).toBe(true);
    expect(isEntitled({ status: 'past_due', accessRevoked: false })).toBe(true);
    expect(isEntitled({ status: 'paused', accessRevoked: false })).toBe(false);
    expect(isEntitled({ status: 'canceled', accessRevoked: false })).toBe(false);
    expect(isEntitled({ status: null, accessRevoked: false })).toBe(false);
    expect(isEntitled({ status: 'active', accessRevoked: true })).toBe(false);
  });
});

describe('pickPriceId', () => {
  it('prefers a wanted price, else the first one', () => {
    expect(pickPriceId(['pri_addon', 'pri_pro'], 'pri_pro')).toBe('pri_pro');
    expect(pickPriceId(['pri_addon', 'pri_team'], ['pri_pro', 'pri_team'])).toBe('pri_team');
    expect(pickPriceId(['pri_addon'], 'pri_pro')).toBe('pri_addon');
    expect(pickPriceId([], 'pri_pro')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { signPaddlePayload, verifyPaddleSignature } from '../src';

const SECRET = 'pdl_ntfset_test_secret';
const BODY = Buffer.from('{"event_id":"evt_1","event_type":"subscription.created"}');
const NOW = 1_763_251_200;

function header(timestamp: number, body = BODY, secret = SECRET): string {
  return `ts=${timestamp};h1=${signPaddlePayload(secret, timestamp, body)}`;
}

describe('verifyPaddleSignature', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyPaddleSignature({ header: header(NOW), rawBody: BODY, secret: SECRET, nowSeconds: NOW })).toBe('valid');
  });

  it('accepts any of several h1 values (secret rotation)', () => {
    const value = `ts=${NOW};h1=${'0'.repeat(64)};h1=${signPaddlePayload(SECRET, NOW, BODY)}`;
    expect(verifyPaddleSignature({ header: value, rawBody: BODY, secret: SECRET, nowSeconds: NOW })).toBe('valid');
  });

  it('rejects a tampered body', () => {
    const tampered = Buffer.from(BODY.toString().replace('created', 'canceled'));
    expect(verifyPaddleSignature({ header: header(NOW), rawBody: tampered, secret: SECRET, nowSeconds: NOW })).toBe('mismatch');
  });

  it('rejects a different secret', () => {
    expect(verifyPaddleSignature({ header: header(NOW, BODY, 'other'), rawBody: BODY, secret: SECRET, nowSeconds: NOW })).toBe('mismatch');
  });

  it('rejects stale timestamps (replays)', () => {
    expect(verifyPaddleSignature({ header: header(NOW - 301), rawBody: BODY, secret: SECRET, nowSeconds: NOW })).toBe('expired');
  });

  it('reports missing and malformed headers', () => {
    expect(verifyPaddleSignature({ header: undefined, rawBody: BODY, secret: SECRET, nowSeconds: NOW })).toBe('missing');
    expect(verifyPaddleSignature({ header: 'ts=abc;h1=xyz', rawBody: BODY, secret: SECRET, nowSeconds: NOW })).toBe('malformed');
  });
});

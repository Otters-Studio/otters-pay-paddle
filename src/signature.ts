import { createHmac, timingSafeEqual } from 'node:crypto';

/** Paddle retries deliveries with a fresh signature, so a short window only rejects replays of captured requests. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureCheck = 'valid' | 'missing' | 'malformed' | 'expired' | 'mismatch';

interface ParsedHeader {
  timestamp: number;
  signatures: string[];
}

/** `Paddle-Signature: ts=1671552777;h1=<hex>` (several h1 values may appear while a secret is rotated). */
function parseHeader(header: string): ParsedHeader | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const [key, value] = part.split('=', 2).map((piece) => piece.trim());
    if (key === 'ts' && value && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'h1' && value && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  return timestamp !== null && signatures.length > 0 ? { timestamp, signatures } : null;
}

/** HMAC-SHA256 over `${ts}:${rawBody}` with the notification destination's endpoint secret key. */
export function signPaddlePayload(secret: string, timestamp: number, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}:`).update(rawBody).digest('hex');
}

export function verifyPaddleSignature(input: {
  header: string | undefined;
  rawBody: Buffer;
  secret: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  if (!input.header) return 'missing';
  const parsed = parseHeader(input.header);
  if (!parsed) return 'malformed';
  if (Math.abs(input.nowSeconds - parsed.timestamp) > (input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) return 'expired';
  const expected = Buffer.from(signPaddlePayload(input.secret, parsed.timestamp, input.rawBody), 'hex');
  const matches = parsed.signatures.some((signature) => timingSafeEqual(Buffer.from(signature, 'hex'), expected));
  return matches ? 'valid' : 'mismatch';
}

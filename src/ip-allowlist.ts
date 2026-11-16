import { z } from 'zod';
import type { Logger } from './types';

const REFRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const ipsResponseSchema = z.object({ data: z.object({ ipv4_cidrs: z.array(z.string()).min(1) }) });

export interface Cidr {
  network: number;
  mask: number;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function parseCidr(cidr: string): Cidr | null {
  const [address, bitsText = '32'] = cidr.trim().split('/');
  const base = address ? ipv4ToInt(address) : null;
  const bits = Number(bitsText);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (base & mask) >>> 0, mask };
}

/** Node reports IPv4 clients on dual-stack sockets as `::ffff:a.b.c.d`. */
export function normalizeIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function ipInCidrs(ip: string | undefined, cidrs: readonly Cidr[]): boolean {
  const normalized = normalizeIp(ip);
  const value = normalized ? ipv4ToInt(normalized) : null;
  if (value === null) return false;
  return cidrs.some((cidr) => ((value & cidr.mask) >>> 0) === cidr.network);
}

/**
 * Paddle's webhook source IPs, fetched from `GET {api}/ips` (never hard-coded) and refreshed hourly.
 * A failed refresh keeps the last good list; with no list at all the webhook fails closed.
 */
export class PaddleIpAllowlist {
  private cidrs: Cidr[] | null = null;
  private fetchedAt = 0;
  private lastAttemptAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly ipsUrl: string,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Null when Paddle's list has never been loaded (answer 503 so Paddle retries). */
  async isAllowed(ip: string | undefined): Promise<boolean | null> {
    await this.refreshIfStale();
    return this.cidrs ? ipInCidrs(ip, this.cidrs) : null;
  }

  refreshIfStale(): Promise<void> {
    const now = this.now();
    const stale = this.cidrs === null || now - this.fetchedAt > REFRESH_MS;
    const mayRetry = now - this.lastAttemptAt > RETRY_MS || this.cidrs === null;
    if (!stale || !mayRetry) return Promise.resolve();
    this.inflight ??= this.refresh().finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async refresh(): Promise<void> {
    this.lastAttemptAt = this.now();
    try {
      const response = await this.fetchImpl(this.ipsUrl, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const cidrs = ipsResponseSchema.parse(await response.json()).data.ipv4_cidrs.map(parseCidr);
      if (cidrs.some((cidr) => cidr === null)) throw new Error('Unparseable CIDR in Paddle IP list');
      this.cidrs = cidrs.filter((cidr): cidr is Cidr => cidr !== null);
      this.fetchedAt = this.now();
    } catch (error) {
      this.logger.warn({ err: error, url: this.ipsUrl, cached: this.cidrs !== null }, 'Could not refresh Paddle webhook IPs');
    }
  }
}

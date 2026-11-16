import { describe, expect, it, vi } from 'vitest';
import { ipInCidrs, parseCidr, PaddleIpAllowlist, type Logger } from '../src';

const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function cidrs(...values: string[]) {
  return values.map((value) => parseCidr(value)!);
}

function ipsResponse(list: string[]): Response {
  return new Response(JSON.stringify({ data: { ipv4_cidrs: list } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('ipInCidrs', () => {
  it('matches single hosts and ranges', () => {
    const list = cidrs('34.232.58.13/32', '10.0.0.0/8');
    expect(ipInCidrs('34.232.58.13', list)).toBe(true);
    expect(ipInCidrs('10.20.30.40', list)).toBe(true);
    expect(ipInCidrs('34.232.58.14', list)).toBe(false);
  });

  it('handles IPv4-mapped IPv6 and rejects garbage', () => {
    const list = cidrs('127.0.0.1/32');
    expect(ipInCidrs('::ffff:127.0.0.1', list)).toBe(true);
    expect(ipInCidrs('::1', list)).toBe(false);
    expect(ipInCidrs(undefined, list)).toBe(false);
    expect(ipInCidrs('999.1.1.1', list)).toBe(false);
  });
});

describe('PaddleIpAllowlist', () => {
  it('loads the list once and caches it', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ipsResponse(['1.2.3.4/32'])));
    const allowlist = new PaddleIpAllowlist('https://example.test/ips', silentLogger, fetchImpl);
    expect(await allowlist.isAllowed('1.2.3.4')).toBe(true);
    expect(await allowlist.isAllowed('5.6.7.8')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed (null) when the list was never loaded, and keeps the old list on a failed refresh', async () => {
    let now = 0;
    const fetchImpl = vi.fn<() => Promise<Response>>().mockRejectedValueOnce(new Error('down'));
    const allowlist = new PaddleIpAllowlist('https://example.test/ips', silentLogger, fetchImpl, () => now);
    expect(await allowlist.isAllowed('1.2.3.4')).toBeNull();

    fetchImpl.mockResolvedValueOnce(ipsResponse(['1.2.3.4/32']));
    expect(await allowlist.isAllowed('1.2.3.4')).toBe(true);

    now += 2 * 60 * 60 * 1000;
    fetchImpl.mockRejectedValueOnce(new Error('down again'));
    expect(await allowlist.isAllowed('1.2.3.4')).toBe(true);
  });
});

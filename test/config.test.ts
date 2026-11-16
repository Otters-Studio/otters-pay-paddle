import { describe, expect, it, vi } from 'vitest';
import { PaddleBilling, PaddleBillingError, validateCredentials, type CredentialOptions } from '../src';

const sandbox: CredentialOptions = {
  environment: 'sandbox',
  apiKey: 'pdl_sdbx_apikey_01abcdefghijklmnop',
  clientToken: 'test_abcdef123',
  webhookSecret: 'pdl_ntfset_01abcdefghijklmnop',
};
const production: CredentialOptions = {
  environment: 'production',
  apiKey: 'pdl_live_apikey_01abcdefghijklmnop',
  clientToken: 'live_abcdef123',
  webhookSecret: 'pdl_ntfset_01abcdefghijklmnop',
};

function failure(options: CredentialOptions): string {
  try {
    validateCredentials(options);
  } catch (error) {
    expect(error).toBeInstanceOf(PaddleBillingError);
    expect((error as PaddleBillingError).code).toBe('BILLING_CONFIG_INVALID');
    return (error as Error).message;
  }
  throw new Error('expected the configuration to be rejected');
}

describe('validateCredentials', () => {
  it('accepts matching credentials and picks the official URL', () => {
    expect(validateCredentials(sandbox)).toBe('https://sandbox-api.paddle.com');
    expect(validateCredentials(production)).toBe('https://api.paddle.com');
  });

  it('rejects keys and tokens from the other environment', () => {
    expect(failure({ ...production, apiKey: sandbox.apiKey })).toMatch(/other Paddle environment/);
    expect(failure({ ...sandbox, apiKey: production.apiKey })).toMatch(/other Paddle environment/);
    expect(failure({ ...production, clientToken: sandbox.clientToken })).toMatch(/clientToken/);
    expect(failure({ ...sandbox, clientToken: production.clientToken })).toMatch(/clientToken/);
  });

  it('rejects an unknown environment', () => {
    expect(failure({ ...sandbox, environment: 'live' as never })).toMatch(/environment/);
  });

  it('rejects unprefixed API keys unless legacy keys are allowed', () => {
    const legacy = 'a3f1c2b4d5e6f7a8b9c0d1e2f3a4b5c6';
    expect(failure({ ...production, apiKey: legacy })).toMatch(/allowLegacyApiKey/);
    expect(validateCredentials({ ...production, apiKey: legacy, allowLegacyApiKey: true })).toBe('https://api.paddle.com');
    expect(failure({ ...production, apiKey: 'short', allowLegacyApiKey: true })).toMatch(/too short/);
    expect(failure({ ...production, apiKey: 'pdl_other_xxxxxxxxxxxxxxxxx', allowLegacyApiKey: true })).toMatch(/production API key/);
  });

  it('rejects empty, short, padded or reused webhook secrets', () => {
    expect(failure({ ...sandbox, webhookSecret: '' })).toMatch(/webhookSecret is required/);
    expect(failure({ ...sandbox, webhookSecret: 'short' })).toMatch(/at least 16/);
    expect(failure({ ...sandbox, webhookSecret: `${sandbox.webhookSecret}\n` })).toMatch(/whitespace/);
    expect(failure({ ...sandbox, webhookSecret: sandbox.apiKey })).toMatch(/not an API key/);
  });

  it('never puts secret values in error messages', () => {
    const message = failure({ ...production, apiKey: 'pdl_sdbx_supersecretvalue_123456' });
    expect(message).not.toContain('supersecretvalue');
  });

  it('keeps the API key on Paddle in production', () => {
    expect(failure({ ...production, apiBaseUrl: 'https://evil.example' })).toMatch(/production/);
    expect(validateCredentials({ ...production, apiBaseUrl: 'https://api.paddle.com/' })).toBe('https://api.paddle.com');
  });

  it('allows sandbox overrides over https, or http only on localhost', () => {
    expect(validateCredentials({ ...sandbox, apiBaseUrl: 'http://127.0.0.1:4010/' })).toBe('http://127.0.0.1:4010');
    expect(validateCredentials({ ...sandbox, apiBaseUrl: 'https://mock.example.test' })).toBe('https://mock.example.test');
    expect(failure({ ...sandbox, apiBaseUrl: 'http://mock.example.test' })).toMatch(/https/);
    expect(failure({ ...sandbox, apiBaseUrl: 'https://user:pass@mock.example.test' })).toMatch(/credentials/);
    expect(failure({ ...sandbox, apiBaseUrl: 'not a url' })).toMatch(/valid URL/);
  });
});

describe('PaddleBilling configuration', () => {
  it('refuses to start with invalid credentials', () => {
    expect(() => new PaddleBilling({ ...production, apiKey: sandbox.apiKey })).toThrow(PaddleBillingError);
  });

  it('warns when the IP check is off in production', () => {
    const warn = vi.fn();
    new PaddleBilling({ ...production, verifyWebhookIp: false, logger: { info: vi.fn(), warn, error: vi.fn() } });
    expect(warn).toHaveBeenCalledOnce();
  });
});

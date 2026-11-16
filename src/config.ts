import { PaddleBillingError } from './errors';
import type { PaddleEnvironment } from './types';

export const PADDLE_API_BASE_URLS: Readonly<Record<PaddleEnvironment, string>> = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
};

const PREFIXES: Readonly<Record<PaddleEnvironment, { apiKey: string; clientToken: string }>> = {
  sandbox: { apiKey: 'pdl_sdbx_', clientToken: 'test_' },
  production: { apiKey: 'pdl_live_', clientToken: 'live_' },
};

const MIN_WEBHOOK_SECRET_LENGTH = 16;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface CredentialOptions {
  environment: PaddleEnvironment;
  apiKey: string;
  clientToken: string;
  webhookSecret: string;
  apiBaseUrl?: string;
  allowLegacyApiKey?: boolean;
}

/** Messages name the setting, never its value. */
function invalid(message: string): never {
  throw new PaddleBillingError(500, 'BILLING_CONFIG_INVALID', `otters-pay-paddle: ${message}`);
}

function requireToken(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) invalid(`${name} is required`);
  if (/\s/.test(value)) invalid(`${name} contains whitespace (check for a stray newline or space)`);
  return value;
}

/**
 * Rejects configurations that would silently weaken security or mix environments:
 * keys from the other environment, empty or short webhook secrets, and API URLs the API key must never be sent to.
 * Returns the API base URL to use (without a trailing slash).
 */
export function validateCredentials(options: CredentialOptions): string {
  const { environment } = options;
  if (environment !== 'sandbox' && environment !== 'production') invalid("environment must be 'sandbox' or 'production'");
  const prefix = PREFIXES[environment];

  const apiKey = requireToken('apiKey', options.apiKey);
  if (!apiKey.startsWith(prefix.apiKey)) {
    const otherEnvironment = apiKey.startsWith(PREFIXES[environment === 'sandbox' ? 'production' : 'sandbox'].apiKey);
    if (otherEnvironment) invalid(`apiKey belongs to the other Paddle environment (environment is '${environment}')`);
    if (apiKey.startsWith('pdl_') || !options.allowLegacyApiKey) {
      invalid(`apiKey must be a ${environment} API key (${prefix.apiKey}…); for a key created before Paddle's prefixed keys, set allowLegacyApiKey`);
    }
    if (apiKey.length < 20) invalid('apiKey is too short to be a Paddle API key');
  }

  const clientToken = requireToken('clientToken', options.clientToken);
  if (!clientToken.startsWith(prefix.clientToken) || clientToken.length <= prefix.clientToken.length) {
    invalid(`clientToken must be a ${environment} client-side token (${prefix.clientToken}…)`);
  }

  const webhookSecret = requireToken('webhookSecret', options.webhookSecret);
  if (webhookSecret.length < MIN_WEBHOOK_SECRET_LENGTH) {
    invalid(`webhookSecret must be at least ${MIN_WEBHOOK_SECRET_LENGTH} characters (use the notification destination's secret key)`);
  }
  if (webhookSecret === apiKey || webhookSecret === clientToken) invalid('webhookSecret must be the notification secret, not an API key or token');

  return resolveApiBaseUrl(environment, options.apiBaseUrl);
}

/** The API key travels to this URL, so production only ever talks to Paddle, and nothing goes over plain HTTP except to this machine. */
function resolveApiBaseUrl(environment: PaddleEnvironment, override: string | undefined): string {
  const official = PADDLE_API_BASE_URLS[environment];
  if (override === undefined) return official;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    invalid('apiBaseUrl is not a valid URL');
  }
  if (url.username || url.password || url.search || url.hash) invalid('apiBaseUrl must not contain credentials, a query or a fragment');
  const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  if (normalized === official) return official;
  if (environment === 'production') invalid('apiBaseUrl cannot be overridden in production');
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) invalid('apiBaseUrl must use https (plain http is only allowed for localhost)');
  return normalized;
}

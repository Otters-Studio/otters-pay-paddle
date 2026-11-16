export type PaddleBillingErrorCode =
  | 'BILLING_CONFIG_INVALID'
  | 'BILLING_UPSTREAM_FAILED'
  | 'BILLING_WEBHOOK_UNAVAILABLE'
  | 'BILLING_WEBHOOK_FORBIDDEN'
  | 'BILLING_WEBHOOK_SIGNATURE_INVALID'
  | 'BILLING_WEBHOOK_MALFORMED';

/** Every error this package throws on purpose. `status` is the HTTP status to answer with. */
export class PaddleBillingError extends Error {
  constructor(
    readonly status: number,
    readonly code: PaddleBillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaddleBillingError';
  }
}

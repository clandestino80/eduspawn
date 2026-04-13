/**
 * Provider-agnostic billing vocabulary. Adapters (Stripe, Apple, Google) map into
 * `NormalizedBillingIntent` + these labels; core processing stays in `billing-event-processor.service`.
 */
export {
  NORMALIZED_BILLING_EVENT,
  type NormalizedBillingEventLabel,
  type NormalizedBillingIntent,
} from "./billing-event-types";

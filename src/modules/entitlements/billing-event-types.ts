import type { BillingPlanTier, BillingSubscriptionStatus } from "@prisma/client";

/** Internal normalized intents — provider adapters map into this shape. */
export type NormalizedBillingIntent =
  | {
      kind: "subscription_sync";
      userId: string;
      planTier: BillingPlanTier;
      subscriptionStatus: BillingSubscriptionStatus;
      periodStart: Date | null;
      periodEnd: Date | null;
      stripeCustomerId: string | null;
    }
  | { kind: "credit_purchase"; userId: string; credits: number; externalRef: string }
  | { kind: "noop"; reason: string };

export const NORMALIZED_BILLING_EVENT = {
  SUBSCRIPTION_ACTIVATED: "subscription_activated",
  SUBSCRIPTION_RENEWED: "subscription_renewed",
  SUBSCRIPTION_CANCELED: "subscription_canceled",
  SUBSCRIPTION_PAST_DUE: "subscription_past_due",
  TRIAL_STARTED: "trial_started",
  TRIAL_ENDED: "trial_ended",
  CREDIT_PURCHASE_COMPLETED: "credit_purchase_completed",
  CREDIT_GRANT: "credit_grant",
  REFUND_OR_REVERSAL: "refund_or_reversal",
  UNKNOWN_OR_IGNORED: "unknown_or_ignored",
} as const;

export type NormalizedBillingEventLabel = (typeof NORMALIZED_BILLING_EVENT)[keyof typeof NORMALIZED_BILLING_EVENT];

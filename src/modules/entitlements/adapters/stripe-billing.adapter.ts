import type { BillingPlanTier, BillingSubscriptionStatus } from "@prisma/client";
import { getEnv } from "../../../config/env";
import { NORMALIZED_BILLING_EVENT, type NormalizedBillingIntent } from "../billing-event-types";
import type { StripeWebhookEventJson } from "./stripe-webhook-verify";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function numDate(sec: unknown): Date | null {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return null;
  return new Date(sec * 1000);
}

function firstPriceId(sub: Record<string, unknown>): string | null {
  const items = sub.items;
  const ir = asRecord(items);
  if (!ir) return null;
  const data = ir.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = asRecord(data[0]);
  if (!first) return null;
  const price = asRecord(first.price);
  if (!price) return null;
  return typeof price.id === "string" ? price.id : null;
}

function tierFromStripePriceId(priceId: string | null): BillingPlanTier | null {
  if (!priceId) return null;
  const env = getEnv();
  const pro = env.STRIPE_PRICE_ID_PRO?.trim();
  const prem = env.STRIPE_PRICE_ID_PREMIUM?.trim();
  if (prem && priceId === prem) return "PREMIUM";
  if (pro && priceId === pro) return "PRO";
  return null;
}

function mapStripeSubscriptionStatus(
  status: string,
  trialEnd: Date | null,
  now = new Date(),
): BillingSubscriptionStatus {
  if (status === "trialing") return "TRIALING";
  if (status === "past_due") return "PAST_DUE";
  if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
    return "CANCELED";
  }
  if (status === "active") {
    if (trialEnd != null && now < trialEnd) return "TRIALING";
    return "ACTIVE";
  }
  return "CANCELED";
}

function normalizedLabelForStripeSubscription(
  status: string,
  eventType: string,
): (typeof NORMALIZED_BILLING_EVENT)[keyof typeof NORMALIZED_BILLING_EVENT] {
  if (eventType === "customer.subscription.deleted") {
    return NORMALIZED_BILLING_EVENT.SUBSCRIPTION_CANCELED;
  }
  if (status === "past_due") return NORMALIZED_BILLING_EVENT.SUBSCRIPTION_PAST_DUE;
  if (status === "trialing") return NORMALIZED_BILLING_EVENT.TRIAL_STARTED;
  if (status === "active") return NORMALIZED_BILLING_EVENT.SUBSCRIPTION_RENEWED;
  if (status === "canceled" || status === "unpaid") {
    return NORMALIZED_BILLING_EVENT.SUBSCRIPTION_CANCELED;
  }
  return NORMALIZED_BILLING_EVENT.UNKNOWN_OR_IGNORED;
}

function metadataUserId(meta: unknown): string | null {
  const m = asRecord(meta);
  if (!m) return null;
  const v = m.eduspawn_user_id ?? m.eduspawnUserId;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export type StripeAdapterResult = {
  normalizedEventType: string;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  externalProductId: string | null;
  userIdHint: string | null;
  intents: NormalizedBillingIntent[];
};

/**
 * Maps a verified Stripe event JSON into normalized intents (no I/O).
 * User resolution uses `metadata.eduspawn_user_id` on subscription/session or caller-supplied lookups.
 */
export function stripeWebhookEventToIntents(event: StripeWebhookEventJson): StripeAdapterResult {
  const base: Omit<StripeAdapterResult, "intents" | "normalizedEventType"> = {
    externalCustomerId: null,
    externalSubscriptionId: null,
    externalProductId: null,
    userIdHint: null,
  };

  if (event.type.startsWith("customer.subscription.")) {
    const sub = asRecord(event.data.object);
    if (!sub) {
      return {
        ...base,
        normalizedEventType: NORMALIZED_BILLING_EVENT.UNKNOWN_OR_IGNORED,
        intents: [{ kind: "noop", reason: "stripe_subscription_missing_object" }],
      };
    }
    const subId = typeof sub.id === "string" ? sub.id : null;
    const customer = sub.customer;
    const customerId = typeof customer === "string" ? customer : null;
    const status = typeof sub.status === "string" ? sub.status : "canceled";
    const trialEnd = numDate(sub.trial_end);
    const periodStart = numDate(sub.current_period_start);
    const periodEnd = numDate(sub.current_period_end);
    const priceId = firstPriceId(sub);
    base.externalCustomerId = customerId;
    base.externalSubscriptionId = subId;
    base.externalProductId = priceId;
    base.userIdHint = metadataUserId(sub.metadata);

    const tier = tierFromStripePriceId(priceId);
    if (!base.userIdHint) {
      return {
        ...base,
        normalizedEventType: NORMALIZED_BILLING_EVENT.UNKNOWN_OR_IGNORED,
        intents: [
          {
            kind: "noop",
            reason: "missing_eduspawn_user_id_on_subscription_metadata",
          },
        ],
      };
    }
    if (!tier) {
      return {
        ...base,
        normalizedEventType: NORMALIZED_BILLING_EVENT.UNKNOWN_OR_IGNORED,
        intents: [
          {
            kind: "noop",
            reason: `unmapped_stripe_price_id:${priceId ?? "none"}`,
          },
        ],
      };
    }

    const subscriptionStatus = mapStripeSubscriptionStatus(status, trialEnd);
    const normalizedEventType = normalizedLabelForStripeSubscription(status, event.type);

    return {
      ...base,
      normalizedEventType,
      intents: [
        {
          kind: "subscription_sync",
          userId: base.userIdHint,
          planTier: tier,
          subscriptionStatus,
          periodStart,
          periodEnd,
          stripeCustomerId: customerId,
        },
      ],
    };
  }

  if (event.type === "checkout.session.completed") {
    const session = asRecord(event.data.object);
    if (!session) {
      return {
        ...base,
        normalizedEventType: NORMALIZED_BILLING_EVENT.UNKNOWN_OR_IGNORED,
        intents: [{ kind: "noop", reason: "stripe_checkout_missing_object" }],
      };
    }
    const mode = typeof session.mode === "string" ? session.mode : "";
    const payStatus = typeof session.payment_status === "string" ? session.payment_status : "";
    const metaUser =
      metadataUserId(session.metadata) ??
      (typeof session.client_reference_id === "string" && session.client_reference_id.trim()
        ? session.client_reference_id.trim()
        : null);
    const customer = session.customer;
    base.externalCustomerId = typeof customer === "string" ? customer : null;
    base.userIdHint = metaUser;

    if (mode !== "payment" || payStatus !== "paid") {
      return {
        ...base,
        normalizedEventType: NORMALIZED_BILLING_EVENT.UNKNOWN_OR_IGNORED,
        intents: [{ kind: "noop", reason: `checkout_mode_${mode}_payment_status_${payStatus}` }],
      };
    }
    const meta = asRecord(session.metadata);
    const creditsRaw = meta?.render_credits ?? meta?.renderCredits;
    const credits =
      typeof creditsRaw === "string"
        ? Number.parseInt(creditsRaw, 10)
        : typeof creditsRaw === "number"
          ? Math.floor(creditsRaw)
          : 0;
    if (!metaUser) {
      return {
        ...base,
        normalizedEventType: NORMALIZED_BILLING_EVENT.UNKNOWN_OR_IGNORED,
        intents: [{ kind: "noop", reason: "checkout_missing_user_reference" }],
      };
    }
    if (!Number.isFinite(credits) || credits <= 0) {
      return {
        ...base,
        normalizedEventType: NORMALIZED_BILLING_EVENT.UNKNOWN_OR_IGNORED,
        intents: [{ kind: "noop", reason: "checkout_missing_render_credits_metadata" }],
      };
    }
    const sessionId = typeof session.id === "string" ? session.id : event.id;
    return {
      ...base,
      normalizedEventType: NORMALIZED_BILLING_EVENT.CREDIT_PURCHASE_COMPLETED,
      intents: [
        {
          kind: "credit_purchase",
          userId: metaUser,
          credits,
          externalRef: sessionId,
        },
      ],
    };
  }

  return {
    ...base,
    normalizedEventType: NORMALIZED_BILLING_EVENT.UNKNOWN_OR_IGNORED,
    intents: [{ kind: "noop", reason: `unhandled_stripe_type:${event.type}` }],
  };
}

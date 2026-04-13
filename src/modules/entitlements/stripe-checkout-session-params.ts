import type { CheckoutPlanTier, CreditPack } from "./stripe-checkout.types";

/** Serializable shape compatible with Stripe `checkout.sessions.create` (no `stripe` import). */
export type StripeCheckoutSessionCreateParamsJson = {
  mode: "subscription" | "payment";
  line_items: { price: string; quantity: number }[];
  success_url: string;
  cancel_url: string;
  client_reference_id: string;
  metadata: Record<string, string>;
  customer?: string;
  customer_email?: string;
  customer_creation?: "always";
  subscription_data?: { metadata: Record<string, string> };
};

export function buildSubscriptionCheckoutSessionParams(args: {
  userId: string;
  planTier: CheckoutPlanTier;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  stripeCustomerId: string | null;
}): StripeCheckoutSessionCreateParamsJson {
  const meta = {
    eduspawn_user_id: args.userId,
    eduspawn_plan_intent: args.planTier,
  };
  const base: StripeCheckoutSessionCreateParamsJson = {
    mode: "subscription",
    line_items: [{ price: args.priceId, quantity: 1 }],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    client_reference_id: args.userId,
    metadata: { ...meta },
    subscription_data: {
      metadata: { ...meta },
    },
  };
  if (args.stripeCustomerId) {
    base.customer = args.stripeCustomerId;
  } else {
    base.customer_email = args.customerEmail;
    base.customer_creation = "always";
  }
  return base;
}

export function buildCreditsCheckoutSessionParams(args: {
  userId: string;
  creditPack: CreditPack;
  renderCredits: number;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  stripeCustomerId: string | null;
}): StripeCheckoutSessionCreateParamsJson {
  const meta = {
    eduspawn_user_id: args.userId,
    render_credits: String(args.renderCredits),
    eduspawn_credit_pack: args.creditPack,
  };
  const base: StripeCheckoutSessionCreateParamsJson = {
    mode: "payment",
    line_items: [{ price: args.priceId, quantity: 1 }],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    client_reference_id: args.userId,
    metadata: { ...meta },
  };
  if (args.stripeCustomerId) {
    base.customer = args.stripeCustomerId;
  } else {
    base.customer_email = args.customerEmail;
    base.customer_creation = "always";
  }
  return base;
}

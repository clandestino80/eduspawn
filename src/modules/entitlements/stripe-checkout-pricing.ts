import type { CheckoutPlanTier, CreditPack } from "./stripe-checkout.types";

/** Subset of `Env` used for Stripe price resolution (tests can pass plain objects). */
export type StripeCheckoutPriceEnv = {
  STRIPE_PRICE_ID_PRO?: string | null | undefined;
  STRIPE_PRICE_ID_PREMIUM?: string | null | undefined;
  STRIPE_PRICE_ID_RENDER_CREDITS_SMALL?: string | null | undefined;
  STRIPE_PRICE_ID_RENDER_CREDITS_MEDIUM?: string | null | undefined;
  STRIPE_PRICE_ID_RENDER_CREDITS_LARGE?: string | null | undefined;
};

export function resolveSubscriptionStripePriceId(
  planTier: CheckoutPlanTier,
  env: StripeCheckoutPriceEnv,
): string | null {
  const id =
    planTier === "premium" ? env.STRIPE_PRICE_ID_PREMIUM?.trim() : env.STRIPE_PRICE_ID_PRO?.trim();
  return id && id.length > 0 ? id : null;
}

export function resolveCreditPackStripePriceId(pack: CreditPack, env: StripeCheckoutPriceEnv): string | null {
  const raw = {
    small: env.STRIPE_PRICE_ID_RENDER_CREDITS_SMALL,
    medium: env.STRIPE_PRICE_ID_RENDER_CREDITS_MEDIUM,
    large: env.STRIPE_PRICE_ID_RENDER_CREDITS_LARGE,
  }[pack];
  const id = raw?.trim();
  return id && id.length > 0 ? id : null;
}

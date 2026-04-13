import Stripe from "stripe";

import { getEnv } from "../../../config/env";
import { AppError } from "../../../lib/errors";
import {
  resolveCreditPackStripePriceId,
  resolveSubscriptionStripePriceId,
} from "../stripe-checkout-pricing";
import {
  buildCreditsCheckoutSessionParams,
  buildSubscriptionCheckoutSessionParams,
} from "../stripe-checkout-session-params";
import type { CheckoutPlanTier, CreditPack } from "../stripe-checkout.types";
import { RENDER_CREDITS_BY_PACK } from "../stripe-checkout.types";
import { findUserCheckoutContext, trySetUserStripeCustomerId } from "../repositories/user-stripe.repository";

export type { CheckoutPlanTier, CreditPack } from "../stripe-checkout.types";
export { RENDER_CREDITS_BY_PACK } from "../stripe-checkout.types";

let stripeSingleton: Stripe | null = null;

function getStripeClient(): Stripe {
  const key = getEnv().STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new AppError(503, "Stripe checkout is not configured", { code: "BILLING_STRIPE_NOT_CONFIGURED" });
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key);
  }
  return stripeSingleton;
}

function requireCheckoutRedirectUrls(env: ReturnType<typeof getEnv>): { successUrl: string; cancelUrl: string } {
  const successUrl = env.STRIPE_CHECKOUT_SUCCESS_URL;
  const cancelUrl = env.STRIPE_CHECKOUT_CANCEL_URL;
  if (!successUrl?.trim() || !cancelUrl?.trim()) {
    throw new AppError(503, "Stripe checkout redirect URLs are not configured", {
      code: "BILLING_STRIPE_CHECKOUT_URLS_MISSING",
    });
  }
  return { successUrl: successUrl.trim(), cancelUrl: cancelUrl.trim() };
}

export async function createStripeSubscriptionCheckoutSession(params: {
  userId: string;
  planTier: CheckoutPlanTier;
}): Promise<{ checkoutUrl: string; mode: "subscription"; provider: "stripe" }> {
  const env = getEnv();
  const { successUrl, cancelUrl } = requireCheckoutRedirectUrls(env);
  const priceId = resolveSubscriptionStripePriceId(params.planTier, env);
  if (!priceId) {
    throw new AppError(503, `Stripe price is not configured for plan: ${params.planTier}`, {
      code: "BILLING_STRIPE_PRICE_MISSING",
      details: { planTier: params.planTier },
    });
  }

  const user = await findUserCheckoutContext(params.userId);
  if (!user) {
    throw new AppError(404, "User not found", { code: "USER_NOT_FOUND" });
  }

  const stripe = getStripeClient();
  const sessionParams = buildSubscriptionCheckoutSessionParams({
    userId: params.userId,
    planTier: params.planTier,
    priceId,
    successUrl,
    cancelUrl,
    customerEmail: user.email,
    stripeCustomerId: user.stripeCustomerId,
  }) as Stripe.Checkout.SessionCreateParams;

  const session = await stripe.checkout.sessions.create(sessionParams);
  if (!session.url) {
    throw new AppError(502, "Stripe did not return a checkout URL", { code: "BILLING_STRIPE_NO_CHECKOUT_URL" });
  }

  if (typeof session.customer === "string" && session.customer.length > 0 && !user.stripeCustomerId) {
    await trySetUserStripeCustomerId(params.userId, session.customer);
  }

  return { checkoutUrl: session.url, mode: "subscription", provider: "stripe" };
}

export async function createStripeCreditsCheckoutSession(params: {
  userId: string;
  creditPack: CreditPack;
}): Promise<{ checkoutUrl: string; mode: "payment"; provider: "stripe" }> {
  const env = getEnv();
  const { successUrl, cancelUrl } = requireCheckoutRedirectUrls(env);
  const priceId = resolveCreditPackStripePriceId(params.creditPack, env);
  if (!priceId) {
    throw new AppError(503, `Stripe price is not configured for credit pack: ${params.creditPack}`, {
      code: "BILLING_STRIPE_PRICE_MISSING",
      details: { creditPack: params.creditPack },
    });
  }

  const renderCredits = RENDER_CREDITS_BY_PACK[params.creditPack];
  const user = await findUserCheckoutContext(params.userId);
  if (!user) {
    throw new AppError(404, "User not found", { code: "USER_NOT_FOUND" });
  }

  const stripe = getStripeClient();
  const sessionParams = buildCreditsCheckoutSessionParams({
    userId: params.userId,
    creditPack: params.creditPack,
    renderCredits,
    priceId,
    successUrl,
    cancelUrl,
    customerEmail: user.email,
    stripeCustomerId: user.stripeCustomerId,
  }) as Stripe.Checkout.SessionCreateParams;

  const session = await stripe.checkout.sessions.create(sessionParams);
  if (!session.url) {
    throw new AppError(502, "Stripe did not return a checkout URL", { code: "BILLING_STRIPE_NO_CHECKOUT_URL" });
  }

  if (typeof session.customer === "string" && session.customer.length > 0 && !user.stripeCustomerId) {
    await trySetUserStripeCustomerId(params.userId, session.customer);
  }

  return { checkoutUrl: session.url, mode: "payment", provider: "stripe" };
}

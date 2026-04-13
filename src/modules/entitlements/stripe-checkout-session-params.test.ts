import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCreditPackStripePriceId,
  resolveSubscriptionStripePriceId,
} from "./stripe-checkout-pricing";
import {
  buildCreditsCheckoutSessionParams,
  buildSubscriptionCheckoutSessionParams,
} from "./stripe-checkout-session-params";
import { RENDER_CREDITS_BY_PACK } from "./stripe-checkout.types";

test("stripe checkout session params (webhook-compatible metadata)", async (t) => {
  await t.test("subscription metadata includes eduspawn_user_id and plan intent", () => {
    const p = buildSubscriptionCheckoutSessionParams({
      userId: "user-abc",
      planTier: "premium",
      priceId: "price_prem_1",
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel",
      customerEmail: "u@example.com",
      stripeCustomerId: null,
    });
    assert.equal(p.mode, "subscription");
    assert.equal(p.metadata.eduspawn_user_id, "user-abc");
    assert.equal(p.metadata.eduspawn_plan_intent, "premium");
    assert.equal(p.subscription_data?.metadata.eduspawn_user_id, "user-abc");
    assert.equal(p.line_items[0]?.price, "price_prem_1");
    assert.equal(p.customer_email, "u@example.com");
    assert.equal(p.customer_creation, "always");
    assert.equal(p.client_reference_id, "user-abc");
  });

  await t.test("subscription reuses stripe customer when set", () => {
    const p = buildSubscriptionCheckoutSessionParams({
      userId: "user-abc",
      planTier: "pro",
      priceId: "price_pro_1",
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel",
      customerEmail: "u@example.com",
      stripeCustomerId: "cus_existing",
    });
    assert.equal(p.customer, "cus_existing");
    assert.equal(p.customer_email, undefined);
    assert.equal(p.customer_creation, undefined);
  });

  await t.test("credits payment metadata matches webhook processor", () => {
    const credits = RENDER_CREDITS_BY_PACK.large;
    const p = buildCreditsCheckoutSessionParams({
      userId: "user-xyz",
      creditPack: "large",
      renderCredits: credits,
      priceId: "price_credits_lg",
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel",
      customerEmail: "u@example.com",
      stripeCustomerId: null,
    });
    assert.equal(p.mode, "payment");
    assert.equal(p.metadata.eduspawn_user_id, "user-xyz");
    assert.equal(p.metadata.render_credits, String(credits));
    assert.equal(p.metadata.eduspawn_credit_pack, "large");
    assert.equal(p.line_items[0]?.price, "price_credits_lg");
  });
});

test("stripe checkout price resolution from env-shaped object", async (t) => {
  await t.test("maps pro / premium price ids", () => {
    const env = {
      STRIPE_PRICE_ID_PRO: " price_pro ",
      STRIPE_PRICE_ID_PREMIUM: "price_prem",
    };
    assert.equal(resolveSubscriptionStripePriceId("pro", env), "price_pro");
    assert.equal(resolveSubscriptionStripePriceId("premium", env), "price_prem");
  });

  await t.test("returns null when price missing", () => {
    assert.equal(resolveSubscriptionStripePriceId("pro", {}), null);
    assert.equal(resolveCreditPackStripePriceId("small", {}), null);
  });

  await t.test("maps credit pack price ids", () => {
    const env = {
      STRIPE_PRICE_ID_RENDER_CREDITS_SMALL: "pr_s",
      STRIPE_PRICE_ID_RENDER_CREDITS_MEDIUM: "pr_m",
      STRIPE_PRICE_ID_RENDER_CREDITS_LARGE: "pr_l",
    };
    assert.equal(resolveCreditPackStripePriceId("small", env), "pr_s");
    assert.equal(resolveCreditPackStripePriceId("medium", env), "pr_m");
    assert.equal(resolveCreditPackStripePriceId("large", env), "pr_l");
  });
});

import { Router } from "express";

import { getEnv } from "../../config/env";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { rateLimitPerAuthenticatedUser } from "../../middleware/rate-limit.middleware";
import { postCreditsCheckoutController, postSubscriptionCheckoutController } from "./billing-checkout.controller";

/**
 * Authenticated purchase initiation (Stripe Checkout). Entitlements/credits still apply via webhooks only.
 */
export const billingCheckoutRouter = Router();

billingCheckoutRouter.use(requireAuth);

const billingCheckoutRateLimit = rateLimitPerAuthenticatedUser("billing_checkout", () => ({
  windowMs: getEnv().RATE_LIMIT_BILLING_CHECKOUT_WINDOW_MS,
  max: getEnv().RATE_LIMIT_BILLING_CHECKOUT_MAX,
}));

billingCheckoutRouter.post(
  "/checkout/subscription",
  billingCheckoutRateLimit,
  asyncHandler(postSubscriptionCheckoutController),
);
billingCheckoutRouter.post("/checkout/credits", billingCheckoutRateLimit, asyncHandler(postCreditsCheckoutController));

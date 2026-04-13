import { Router } from "express";

import { getEnv } from "../../config/env";
import { asyncHandler } from "../../middleware/asyncHandler";
import { rateLimitPerIp } from "../../middleware/rate-limit.middleware";
import { postStripeBillingWebhookController } from "./billing-webhooks.controller";

/** Public Stripe webhook entry (signature-verified inside handler). No JWT. */
export const stripeBillingWebhookRouter = Router();

const stripeWebhookIpLimit = rateLimitPerIp("stripe_billing_webhook", () => ({
  windowMs: getEnv().RATE_LIMIT_STRIPE_WEBHOOK_IP_WINDOW_MS,
  max: getEnv().RATE_LIMIT_STRIPE_WEBHOOK_IP_MAX,
}));

stripeBillingWebhookRouter.post("/", stripeWebhookIpLimit, asyncHandler(postStripeBillingWebhookController));

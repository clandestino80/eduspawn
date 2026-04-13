import type { Request, Response } from "express";
import { ZodError } from "zod";

import { AppError } from "../../lib/errors";
import { logProductEvent } from "../../lib/product-log";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { creditsCheckoutBodySchema, subscriptionCheckoutBodySchema } from "./billing-checkout.schema";
import {
  createStripeCreditsCheckoutSession,
  createStripeSubscriptionCheckoutSession,
} from "./services/stripe-checkout.service";

function mapValidationError(error: ZodError): AppError {
  return new AppError(400, "Request validation failed", {
    code: "VALIDATION_ERROR",
    details: error.flatten().fieldErrors,
  });
}

function parseOrThrow<T>(parseFn: () => T): T {
  try {
    return parseFn();
  } catch (error) {
    if (error instanceof ZodError) {
      throw mapValidationError(error);
    }
    throw error;
  }
}

function getUserId(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  const sub = authReq.user?.sub?.trim();
  if (!sub) {
    throw new AppError(401, "Unauthorized", { code: "AUTH_UNAUTHORIZED" });
  }
  return sub;
}

export async function postSubscriptionCheckoutController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const body = parseOrThrow(() => subscriptionCheckoutBodySchema.parse(req.body));
  const data = await createStripeSubscriptionCheckoutSession({
    userId,
    planTier: body.planTier,
  });
  logProductEvent("billing_checkout_created", { userId, kind: "subscription", planTier: body.planTier });
  res.status(200).json({ success: true, data });
}

export async function postCreditsCheckoutController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const body = parseOrThrow(() => creditsCheckoutBodySchema.parse(req.body));
  const data = await createStripeCreditsCheckoutSession({
    userId,
    creditPack: body.creditPack,
  });
  logProductEvent("billing_checkout_created", { userId, kind: "credits", creditPack: body.creditPack });
  res.status(200).json({ success: true, data });
}

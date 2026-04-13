import type { BillingProvider } from "@prisma/client";
import { AppError } from "../../../lib/errors";
import type { NormalizedBillingIntent } from "../billing-event-types";
import { upsertUserBillingEntitlement } from "../repositories/user-billing-entitlement.repository";
import { trySetUserStripeCustomerId } from "../repositories/user-stripe.repository";
import { grantRenderCredits } from "./credit-wallet.service";
import { ensureUserExistsForBillingOps } from "./billing-admin.service";

export async function applyNormalizedBillingIntents(params: {
  intents: NormalizedBillingIntent[];
  provider: BillingProvider;
  providerEventId: string;
}): Promise<void> {
  for (const intent of params.intents) {
    if (intent.kind === "noop") continue;
    if (intent.kind === "subscription_sync") {
      await ensureUserExistsForBillingOps(intent.userId);
      await upsertUserBillingEntitlement({
        userId: intent.userId,
        planTier: intent.planTier,
        subscriptionStatus: intent.subscriptionStatus,
        currentPeriodStart: intent.periodStart,
        currentPeriodEnd: intent.periodEnd,
        entitlementSource: "WEB_STRIPE",
      });
      if (intent.stripeCustomerId) {
        await trySetUserStripeCustomerId(intent.userId, intent.stripeCustomerId);
      }
      continue;
    }
    if (intent.kind === "credit_purchase") {
      await ensureUserExistsForBillingOps(intent.userId);
      await grantRenderCredits(intent.userId, intent.credits, {
        entryType: "PURCHASE",
        reason: `stripe_event:${params.providerEventId}`,
        source: "stripe_webhook",
        metadataJson: {
          provider: params.provider,
          providerEventId: params.providerEventId,
          externalRef: intent.externalRef,
        },
      });
    }
  }
}

export function assertStripePayloadShape(payload: unknown): asserts payload is {
  id: string;
  type: string;
  data: { object: unknown };
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError(400, "Invalid stored billing payload", { code: "BILLING_PAYLOAD_INVALID" });
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.type !== "string" || !p.data || typeof p.data !== "object") {
    throw new AppError(400, "Invalid stored billing payload shape", { code: "BILLING_PAYLOAD_INVALID" });
  }
}

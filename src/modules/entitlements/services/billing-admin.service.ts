import type { BillingPlanTier, BillingSubscriptionStatus, EntitlementSource } from "@prisma/client";
import { AppError } from "../../../lib/errors";
import { prisma } from "../../../lib/prisma";
import { upsertUserBillingEntitlement } from "../repositories/user-billing-entitlement.repository";
import { grantRenderCredits } from "./credit-wallet.service";

export async function ensureUserExistsForBillingOps(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!u) {
    throw new AppError(404, "User not found", { code: "USER_NOT_FOUND" });
  }
}

function bodyTierToBilling(tier: "free" | "pro" | "premium"): BillingPlanTier {
  if (tier === "premium") return "PREMIUM";
  if (tier === "pro") return "PRO";
  return "FREE";
}

export async function adminSetUserBillingEntitlement(params: {
  userId: string;
  planTier: "free" | "pro" | "premium";
  subscriptionStatus: BillingSubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  entitlementSource: EntitlementSource;
}): Promise<void> {
  await ensureUserExistsForBillingOps(params.userId);
  await upsertUserBillingEntitlement({
    userId: params.userId,
    planTier: bodyTierToBilling(params.planTier),
    subscriptionStatus: params.subscriptionStatus,
    currentPeriodStart: params.currentPeriodStart,
    currentPeriodEnd: params.currentPeriodEnd,
    entitlementSource: params.entitlementSource,
  });
}

export async function adminGrantRenderCredits(params: {
  userId: string;
  amount: number;
  reason?: string | null;
}): Promise<void> {
  await ensureUserExistsForBillingOps(params.userId);
  await grantRenderCredits(params.userId, params.amount, {
    entryType: "ADJUSTMENT",
    reason: params.reason ?? "billing_ops_grant",
    source: "billing_ops",
  });
}

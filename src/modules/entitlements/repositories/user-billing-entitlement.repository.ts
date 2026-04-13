import type { BillingPlanTier, BillingSubscriptionStatus, EntitlementSource } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export type UserBillingEntitlementRow = {
  planTier: BillingPlanTier;
  subscriptionStatus: BillingSubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  entitlementSource: EntitlementSource;
};

const select = {
  planTier: true,
  subscriptionStatus: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  entitlementSource: true,
} as const;

export async function findUserBillingEntitlement(userId: string): Promise<UserBillingEntitlementRow | null> {
  return prisma.userBillingEntitlement.findUnique({
    where: { userId },
    select: select,
  });
}

export async function upsertUserBillingEntitlement(params: {
  userId: string;
  planTier: BillingPlanTier;
  subscriptionStatus: BillingSubscriptionStatus;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  entitlementSource?: EntitlementSource;
}): Promise<UserBillingEntitlementRow> {
  const src = params.entitlementSource ?? "MANUAL";
  const row = await prisma.userBillingEntitlement.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      planTier: params.planTier,
      subscriptionStatus: params.subscriptionStatus,
      currentPeriodStart: params.currentPeriodStart ?? null,
      currentPeriodEnd: params.currentPeriodEnd ?? null,
      entitlementSource: src,
    },
    update: {
      planTier: params.planTier,
      subscriptionStatus: params.subscriptionStatus,
      currentPeriodStart: params.currentPeriodStart ?? null,
      currentPeriodEnd: params.currentPeriodEnd ?? null,
      entitlementSource: src,
    },
    select: select,
  });
  return row;
}

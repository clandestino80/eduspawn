import type { PlanTier } from "../../ai/providers/ai-provider.types";
import { currentUtcPeriodMonth } from "../entitlement-time";
import {
  findUserCreatorUsageMonthlyRow,
  incrementCreatorMinutesUsed,
} from "../repositories/user-creator-usage-monthly.repository";
import {
  getMonthlyCreatorMinutesLimit,
  getUserPlanTier,
  isEntitlementEnforcementEnabled,
} from "./entitlement.service";

export type CreatorQuotaSnapshot = {
  planTier: PlanTier;
  periodMonth: string;
  usedMinutes: number;
  limitMinutes: number;
  remainingMinutes: number;
};

export async function getCurrentCreatorUsage(userId: string): Promise<CreatorQuotaSnapshot> {
  const planTier = await getUserPlanTier(userId);
  const periodMonth = currentUtcPeriodMonth();
  const row = await findUserCreatorUsageMonthlyRow({ userId, periodMonth });
  const used = row?.creatorMinutesUsed ?? 0;
  const limitMinutes = getMonthlyCreatorMinutesLimit(planTier);
  return {
    planTier,
    periodMonth,
    usedMinutes: used,
    limitMinutes,
    remainingMinutes: Math.max(0, limitMinutes - used),
  };
}

export async function canConsumeCreatorMinutes(
  userId: string,
  minutes: number,
): Promise<{ ok: true; snapshot: CreatorQuotaSnapshot } | { ok: false; snapshot: CreatorQuotaSnapshot }> {
  const snapshot = await getCurrentCreatorUsage(userId);
  if (!isEntitlementEnforcementEnabled()) {
    return { ok: true, snapshot };
  }
  if (snapshot.limitMinutes === 0) {
    return { ok: true, snapshot };
  }
  const need = Math.ceil(minutes);
  if (snapshot.remainingMinutes >= need) {
    return { ok: true, snapshot };
  }
  return { ok: false, snapshot };
}

/**
 * Long-form / premium creator flows only — not lesson browse/read.
 */
export async function consumeCreatorMinutes(userId: string, minutes: number): Promise<void> {
  if (!isEntitlementEnforcementEnabled()) {
    return;
  }
  const planTier = await getUserPlanTier(userId);
  if (getMonthlyCreatorMinutesLimit(planTier) === 0) {
    return;
  }
  const periodMonth = currentUtcPeriodMonth();
  await incrementCreatorMinutesUsed({ userId, periodMonth, minutes });
}

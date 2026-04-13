import type { PlanTier } from "../../ai/providers/ai-provider.types";
import { utcUsageDateForNow } from "../entitlement-time";
import {
  findUserGenerationUsageDailyRow,
  incrementFreshGenerationsUsed,
  incrementLearningStartsUsed,
} from "../repositories/user-generation-usage-daily.repository";
import {
  getDailyFreshGenerationLimit,
  getDailyLearningStartLimit,
  getUserPlanTier,
  isEntitlementEnforcementEnabled,
} from "./entitlement.service";

export type FreshGenerationMeterSnapshot = {
  planTier: PlanTier;
  usageDate: string;
  used: number;
  limit: number;
  remaining: number;
};

export async function getTodayFreshGenerationUsage(userId: string): Promise<FreshGenerationMeterSnapshot> {
  const planTier = await getUserPlanTier(userId);
  const usageDate = utcUsageDateForNow();
  const row = await findUserGenerationUsageDailyRow({ userId, usageDate });
  const used = row?.freshGenerationsUsed ?? 0;
  const limit = getDailyFreshGenerationLimit(planTier);
  return {
    planTier,
    usageDate: usageDate.toISOString().slice(0, 10),
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export async function canConsumeFreshGeneration(
  userId: string,
  amount = 1,
): Promise<{ ok: true; snapshot: FreshGenerationMeterSnapshot } | { ok: false; snapshot: FreshGenerationMeterSnapshot }> {
  const snapshot = await getTodayFreshGenerationUsage(userId);
  if (!isEntitlementEnforcementEnabled()) {
    return { ok: true, snapshot };
  }
  if (snapshot.remaining >= amount) {
    return { ok: true, snapshot };
  }
  return { ok: false, snapshot };
}

/**
 * Count one fresh lesson+quiz generation against the user's UTC-daily bucket.
 * Read-only routes must not call this.
 */
export async function consumeFreshGeneration(userId: string, amount = 1): Promise<void> {
  if (!isEntitlementEnforcementEnabled()) {
    return;
  }
  const d = Math.max(1, Math.floor(amount));
  const usageDate = utcUsageDateForNow();
  await incrementFreshGenerationsUsed({ userId, usageDate, delta: d });
}

export type LearningStartMeterSnapshot = {
  planTier: PlanTier;
  usageDate: string;
  used: number;
  limit: number;
  remaining: number;
};

export async function getTodayLearningStartUsage(userId: string): Promise<LearningStartMeterSnapshot> {
  const planTier = await getUserPlanTier(userId);
  const usageDate = utcUsageDateForNow();
  const row = await findUserGenerationUsageDailyRow({ userId, usageDate });
  const used = row?.learningStartsUsed ?? 0;
  const limit = getDailyLearningStartLimit(planTier);
  return {
    planTier,
    usageDate: usageDate.toISOString().slice(0, 10),
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export async function canConsumeLearningStart(
  userId: string,
  amount = 1,
): Promise<{ ok: true; snapshot: LearningStartMeterSnapshot } | { ok: false; snapshot: LearningStartMeterSnapshot }> {
  const snapshot = await getTodayLearningStartUsage(userId);
  if (!isEntitlementEnforcementEnabled()) {
    return { ok: true, snapshot };
  }
  if (snapshot.limit === Number.MAX_SAFE_INTEGER) {
    return { ok: true, snapshot };
  }
  if (snapshot.remaining >= amount) {
    return { ok: true, snapshot };
  }
  return { ok: false, snapshot };
}

/**
 * Count one free-tier learning start (lesson generate or creator generate). Not used for Pro/Premium.
 */
export async function consumeLearningStart(userId: string, amount = 1): Promise<void> {
  if (!isEntitlementEnforcementEnabled()) {
    return;
  }
  const planTier = await getUserPlanTier(userId);
  if (planTier !== "free") {
    return;
  }
  const d = Math.max(1, Math.floor(amount));
  const usageDate = utcUsageDateForNow();
  await incrementLearningStartsUsed({ userId, usageDate, delta: d });
}

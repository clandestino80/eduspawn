import { getEnv } from "../../../config/env";
import type { PlanTier } from "../../ai/providers/ai-provider.types";
import { getCurrentCreatorUsage } from "../../entitlements/services/creator-quota.service";
import { getUserPlanTier } from "../../entitlements/services/entitlement.service";
import { getTodayLearningStartUsage } from "../../entitlements/services/generation-meter.service";

export type CreatorCapacitySummaryDto = {
  planTier: PlanTier;
  /** Percent discount applied when serving creator output from global reuse (Pro/Premium creator minutes). */
  reuseMinuteDiscountPercent: number;
  /** Pro/Premium monthly creator pool; null on free tier. */
  creatorCapacity: {
    periodMonth: string;
    limitMinutes: number;
    usedMinutes: number;
    remainingMinutes: number;
    /** True when monthly creator minutes are exhausted but subscription/plan tier can still be active. */
    creatorGenerationExhausted: boolean;
  } | null;
  /** Free tier daily learning starts; null when not on free tier. */
  dailyLearningStarts: {
    usageDate: string;
    used: number;
    limit: number;
    remaining: number;
    learningStartsExhausted: boolean;
  } | null;
};

export async function getCreatorCapacitySummary(userId: string): Promise<CreatorCapacitySummaryDto> {
  const planTier = await getUserPlanTier(userId);
  const reuseMinuteDiscountPercent = getEnv().CREATOR_REUSE_MINUTE_DISCOUNT_PERCENT;

  if (planTier === "free") {
    const ls = await getTodayLearningStartUsage(userId);
    const limit = ls.limit === Number.MAX_SAFE_INTEGER ? 0 : ls.limit;
    return {
      planTier,
      reuseMinuteDiscountPercent,
      creatorCapacity: null,
      dailyLearningStarts: {
        usageDate: ls.usageDate,
        used: ls.used,
        limit,
        remaining: ls.remaining,
        learningStartsExhausted: limit > 0 && ls.remaining === 0,
      },
    };
  }

  const creator = await getCurrentCreatorUsage(userId);
  const creatorGenerationExhausted =
    creator.limitMinutes > 0 && creator.remainingMinutes === 0;

  return {
    planTier,
    reuseMinuteDiscountPercent,
    creatorCapacity: {
      periodMonth: creator.periodMonth,
      limitMinutes: creator.limitMinutes,
      usedMinutes: creator.usedMinutes,
      remainingMinutes: creator.remainingMinutes,
      creatorGenerationExhausted,
    },
    dailyLearningStarts: null,
  };
}

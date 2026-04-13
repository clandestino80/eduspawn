import type { BillingPlanTier, BillingSubscriptionStatus } from "@prisma/client";
import { getEnv } from "../../../config/env";
import type { PlanTier } from "../../ai/providers/ai-provider.types";
import { findUserBillingEntitlement } from "../repositories/user-billing-entitlement.repository";

function splitCommaIds(raw: string | undefined): Set<string> {
  if (raw === undefined) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

function mapBillingPlanTierToProduct(tier: BillingPlanTier): PlanTier {
  if (tier === "PREMIUM") return "premium";
  if (tier === "PRO") return "pro";
  return "free";
}

/**
 * Env-only tier (pilot list + default). Used when there is no active persisted entitlement row.
 */
export function getEnvFallbackPlanTier(userId: string): PlanTier {
  const env = getEnv();
  if (splitCommaIds(env.ENTITLEMENT_PRO_USER_IDS).has(userId)) {
    return "pro";
  }
  const tier = (env.DEFAULT_PLAN_TIER ?? env.ENTITLEMENT_DEFAULT_PLAN_TIER) as PlanTier;
  if (tier === "free" || tier === "pro" || tier === "premium") {
    return tier;
  }
  return "free";
}

/**
 * Whether a persisted `UserBillingEntitlement` row should drive product limits right now.
 */
export function isPersistedEntitlementActive(
  row: {
    subscriptionStatus: BillingSubscriptionStatus;
    currentPeriodEnd: Date | null;
  },
  now = new Date(),
): boolean {
  switch (row.subscriptionStatus) {
    case "ACTIVE":
    case "TRIALING":
      if (row.currentPeriodEnd != null && now > row.currentPeriodEnd) {
        return false;
      }
      return true;
    case "NONE":
      return true;
    case "CANCELED":
      if (row.currentPeriodEnd == null) {
        return false;
      }
      return now <= row.currentPeriodEnd;
    case "PAST_DUE":
      return false;
    default:
      return false;
  }
}

/**
 * Effective plan tier: prefers an **active** persisted `UserBillingEntitlement` row, else env pilot/default.
 */
export async function getUserPlanTier(userId: string): Promise<PlanTier> {
  const row = await findUserBillingEntitlement(userId);
  if (row && isPersistedEntitlementActive(row)) {
    return mapBillingPlanTierToProduct(row.planTier);
  }
  return getEnvFallbackPlanTier(userId);
}

/** Product rule: browsing/reading is not metered as generation. */
export function getUnlimitedLearningAccess(): boolean {
  return true;
}

export function getDailyFreshGenerationLimit(planTier: PlanTier): number {
  const env = getEnv();
  if (planTier === "premium") {
    return env.PREMIUM_DAILY_FRESH_GENERATION_LIMIT;
  }
  if (planTier === "pro") {
    return env.PRO_DAILY_FRESH_GENERATION_LIMIT;
  }
  return env.FREE_DAILY_FRESH_GENERATION_LIMIT;
}

/**
 * Free-tier daily **learning starts** (new lesson / creator pack generate), product-facing allowance.
 * Pro/Premium are treated as unlimited for this bucket (meter uses other paths).
 */
export function getDailyLearningStartLimit(planTier: PlanTier): number {
  if (planTier !== "free") {
    return Number.MAX_SAFE_INTEGER;
  }
  return getEnv().FREE_DAILY_LEARNING_START_LIMIT;
}

export function getMonthlyCreatorMinutesLimit(planTier: PlanTier): number {
  const env = getEnv();
  if (planTier === "premium") {
    return env.PREMIUM_MONTHLY_CREATOR_MINUTES_LIMIT;
  }
  if (planTier === "pro") {
    return env.PRO_MONTHLY_CREATOR_MINUTES_LIMIT;
  }
  return 0;
}

export function getStarterRenderCreditsPolicy(planTier: PlanTier): number {
  const env = getEnv();
  if (planTier === "pro" || planTier === "premium") {
    return env.PRO_STARTER_RENDER_CREDITS;
  }
  return 0;
}

export function doesRenderRequireCredits(kind: "longform"): boolean {
  const env = getEnv();
  if (!env.RENDER_CREDITS_REQUIRED) {
    return false;
  }
  if (kind === "longform") {
    return env.RENDER_LONGFORM_CREDIT_COST > 0;
  }
  return false;
}

export function getLongformRenderCreditCost(): number {
  return getEnv().RENDER_LONGFORM_CREDIT_COST;
}

export function isEntitlementEnforcementEnabled(): boolean {
  return getEnv().ENTITLEMENT_ENFORCEMENT_ENABLED;
}

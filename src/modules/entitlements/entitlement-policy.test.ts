import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../config/env";
import { prisma } from "../../lib/prisma";

const MIN_ENV = {
  JWT_SECRET: "j".repeat(32),
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x?sslmode=require",
  NODE_ENV: "test",
} as const;

function loadMinimalEnv(overrides: Record<string, string>): void {
  resetEnvCacheForTests();
  for (const [k, v] of Object.entries(MIN_ENV)) {
    process.env[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  resetEnvCacheForTests();
}

test("entitlement policy from env", async (t) => {
  const billing = prisma.userBillingEntitlement as unknown as {
    findUnique: typeof prisma.userBillingEntitlement.findUnique;
  };
  const origBillingFind = billing.findUnique.bind(billing);
  billing.findUnique = (async () => null) as typeof billing.findUnique;

  try {
    await t.test("daily fresh limits per plan tier", async () => {
      loadMinimalEnv({
        FREE_DAILY_FRESH_GENERATION_LIMIT: "2",
        PRO_DAILY_FRESH_GENERATION_LIMIT: "11",
        PREMIUM_DAILY_FRESH_GENERATION_LIMIT: "33",
      });
      const { getDailyFreshGenerationLimit } = await import("./services/entitlement.service");
      assert.equal(getDailyFreshGenerationLimit("free"), 2);
      assert.equal(getDailyFreshGenerationLimit("pro"), 11);
      assert.equal(getDailyFreshGenerationLimit("premium"), 33);
    });

    await t.test("daily learning start limit applies to free only", async () => {
      loadMinimalEnv({
        FREE_DAILY_LEARNING_START_LIMIT: "5",
      });
      const { getDailyLearningStartLimit } = await import("./services/entitlement.service");
      assert.equal(getDailyLearningStartLimit("free"), 5);
      assert.equal(getDailyLearningStartLimit("pro"), Number.MAX_SAFE_INTEGER);
    });

    await t.test("ENTITLEMENT_PRO_USER_IDS overrides tier to pro when no persisted row", async () => {
      loadMinimalEnv({
        ENTITLEMENT_DEFAULT_PLAN_TIER: "free",
        ENTITLEMENT_PRO_USER_IDS: "user-a,user-b",
      });
      const { getUserPlanTier } = await import("./services/entitlement.service");
      assert.equal(await getUserPlanTier("user-a"), "pro");
      assert.equal(await getUserPlanTier("other"), "free");
    });

    await t.test("DEFAULT_PLAN_TIER legacy wins over entitlement default when no persisted row", async () => {
      loadMinimalEnv({
        ENTITLEMENT_DEFAULT_PLAN_TIER: "free",
        DEFAULT_PLAN_TIER: "premium",
      });
      const { getUserPlanTier } = await import("./services/entitlement.service");
      assert.equal(await getUserPlanTier("no-pro-override"), "premium");
    });
  } finally {
    billing.findUnique = origBillingFind;
  }
});

test("persisted billing entitlement overrides env default", async (t) => {
  const billing = prisma.userBillingEntitlement as unknown as {
    findUnique: typeof prisma.userBillingEntitlement.findUnique;
  };
  const origBillingFind = billing.findUnique.bind(billing);

  await t.test("active persisted PRO beats ENTITLEMENT_DEFAULT_PLAN_TIER free", async () => {
    loadMinimalEnv({
      ENTITLEMENT_DEFAULT_PLAN_TIER: "free",
      ENTITLEMENT_PRO_USER_IDS: "",
    });
    billing.findUnique = (async () => ({
      planTier: "PRO",
      subscriptionStatus: "ACTIVE",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      entitlementSource: "MANUAL",
    })) as typeof billing.findUnique;
    const { getUserPlanTier } = await import("./services/entitlement.service");
    assert.equal(await getUserPlanTier("any-user-id"), "pro");
    billing.findUnique = origBillingFind;
  });

  await t.test("PAST_DUE persisted row falls back to env default", async () => {
    loadMinimalEnv({
      ENTITLEMENT_DEFAULT_PLAN_TIER: "free",
    });
    billing.findUnique = (async () => ({
      planTier: "PRO",
      subscriptionStatus: "PAST_DUE",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      entitlementSource: "WEB_STRIPE",
    })) as typeof billing.findUnique;
    const { getUserPlanTier } = await import("./services/entitlement.service");
    assert.equal(await getUserPlanTier("u-fallback"), "free");
    billing.findUnique = origBillingFind;
  });

  billing.findUnique = origBillingFind;
});

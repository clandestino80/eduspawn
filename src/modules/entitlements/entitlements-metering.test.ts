import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../config/env";
import { AppError } from "../../lib/errors";
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

test("generation-meter.service", async (t) => {
  const daily = prisma.userGenerationUsageDaily as unknown as {
    findUnique: typeof prisma.userGenerationUsageDaily.findUnique;
    upsert: typeof prisma.userGenerationUsageDaily.upsert;
  };
  const origFind = daily.findUnique.bind(daily);
  const origUpsert = daily.upsert.bind(daily);
  const billing = prisma.userBillingEntitlement as unknown as {
    findUnique: typeof prisma.userBillingEntitlement.findUnique;
  };
  const origBillingFind = billing.findUnique.bind(billing);
  billing.findUnique = (async () => null) as typeof billing.findUnique;

  await t.test("enforcement off: canConsume ok even when over limit", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "false",
      FREE_DAILY_FRESH_GENERATION_LIMIT: "2",
    });
    daily.findUnique = (async () => ({
      freshGenerationsUsed: 99,
      learningStartsUsed: 0,
      gpt4oMiniShortPacksUsed: 0,
      gpt54ShortPacksUsed: 0,
    })) as typeof daily.findUnique;
    const { canConsumeFreshGeneration } = await import("./services/generation-meter.service");
    const r = await canConsumeFreshGeneration("user-free", 1);
    assert.equal(r.ok, true);
    assert.equal(r.snapshot.remaining, 0);
    daily.findUnique = origFind;
  });

  await t.test("enforcement on: at limit cannot consume", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "true",
      FREE_DAILY_FRESH_GENERATION_LIMIT: "3",
      ENTITLEMENT_DEFAULT_PLAN_TIER: "free",
    });
    daily.findUnique = (async () => ({
      freshGenerationsUsed: 3,
      learningStartsUsed: 0,
      gpt4oMiniShortPacksUsed: 0,
      gpt54ShortPacksUsed: 0,
    })) as typeof daily.findUnique;
    const { canConsumeFreshGeneration } = await import("./services/generation-meter.service");
    const r = await canConsumeFreshGeneration("user-free", 1);
    assert.equal(r.ok, false);
    assert.equal(r.snapshot.remaining, 0);
    daily.findUnique = origFind;
  });

  await t.test("enforcement on: below limit can consume", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "true",
      FREE_DAILY_FRESH_GENERATION_LIMIT: "5",
      ENTITLEMENT_DEFAULT_PLAN_TIER: "free",
    });
    daily.findUnique = (async () => ({
      freshGenerationsUsed: 4,
      learningStartsUsed: 0,
      gpt4oMiniShortPacksUsed: 0,
      gpt54ShortPacksUsed: 0,
    })) as typeof daily.findUnique;
    const { canConsumeFreshGeneration } = await import("./services/generation-meter.service");
    const r = await canConsumeFreshGeneration("user-free", 1);
    assert.equal(r.ok, true);
    assert.equal(r.snapshot.remaining, 1);
    daily.findUnique = origFind;
  });

  await t.test("consumeFreshGeneration skips upsert when enforcement disabled", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "false",
    });
    let upserts = 0;
    daily.upsert = (async () => {
      upserts += 1;
      return {} as never;
    }) as typeof daily.upsert;
    const { consumeFreshGeneration } = await import("./services/generation-meter.service");
    await consumeFreshGeneration("user-free", 2);
    assert.equal(upserts, 0);
    daily.upsert = origUpsert;
  });

  daily.findUnique = origFind;
  daily.upsert = origUpsert;
  billing.findUnique = origBillingFind;
});

test("learning-start meter (free tier)", async (t) => {
  const daily = prisma.userGenerationUsageDaily as unknown as {
    findUnique: typeof prisma.userGenerationUsageDaily.findUnique;
    upsert: typeof prisma.userGenerationUsageDaily.upsert;
  };
  const origFind = daily.findUnique.bind(daily);
  const origUpsert = daily.upsert.bind(daily);
  const billing = prisma.userBillingEntitlement as unknown as {
    findUnique: typeof prisma.userBillingEntitlement.findUnique;
  };
  const origBillingFind = billing.findUnique.bind(billing);
  billing.findUnique = (async () => null) as typeof billing.findUnique;

  await t.test("enforcement on: learning starts exhausted for free", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "true",
      FREE_DAILY_LEARNING_START_LIMIT: "5",
      ENTITLEMENT_DEFAULT_PLAN_TIER: "free",
    });
    daily.findUnique = (async () => ({
      freshGenerationsUsed: 0,
      learningStartsUsed: 5,
      gpt4oMiniShortPacksUsed: 0,
      gpt54ShortPacksUsed: 0,
    })) as typeof daily.findUnique;
    const { canConsumeLearningStart } = await import("./services/generation-meter.service");
    const r = await canConsumeLearningStart("user-free", 1);
    assert.equal(r.ok, false);
    assert.equal(r.snapshot.remaining, 0);
    daily.findUnique = origFind;
  });

  await t.test("consumeLearningStart skips upsert for Pro tier", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "true",
      ENTITLEMENT_PRO_USER_IDS: "pro-user",
    });
    let upserts = 0;
    daily.upsert = (async () => {
      upserts += 1;
      return {} as never;
    }) as typeof daily.upsert;
    const { consumeLearningStart } = await import("./services/generation-meter.service");
    await consumeLearningStart("pro-user", 1);
    assert.equal(upserts, 0);
    daily.upsert = origUpsert;
  });

  daily.findUnique = origFind;
  daily.upsert = origUpsert;
  billing.findUnique = origBillingFind;
});

test("creator-quota.service", async (t) => {
  const monthly = prisma.userCreatorUsageMonthly as unknown as {
    findUnique: typeof prisma.userCreatorUsageMonthly.findUnique;
    upsert: typeof prisma.userCreatorUsageMonthly.upsert;
  };
  const origFind = monthly.findUnique.bind(monthly);
  const origUpsert = monthly.upsert.bind(monthly);
  const billing = prisma.userBillingEntitlement as unknown as {
    findUnique: typeof prisma.userBillingEntitlement.findUnique;
  };
  const origBillingFind = billing.findUnique.bind(billing);
  billing.findUnique = (async () => null) as typeof billing.findUnique;

  await t.test("free tier limit 0: canConsume always ok (no monthly pool)", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "true",
      ENTITLEMENT_DEFAULT_PLAN_TIER: "free",
    });
    monthly.findUnique = (async () => ({
      creatorMinutesUsed: 99999,
      premiumGenerationsUsed: 0,
    })) as typeof monthly.findUnique;
    const { canConsumeCreatorMinutes } = await import("./services/creator-quota.service");
    const r = await canConsumeCreatorMinutes("user-free", 60);
    assert.equal(r.ok, true);
    assert.equal(r.snapshot.limitMinutes, 0);
    monthly.findUnique = origFind;
  });

  await t.test("pro: exhausted monthly minutes", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "true",
      ENTITLEMENT_PRO_USER_IDS: "pro-user",
      PRO_MONTHLY_CREATOR_MINUTES_LIMIT: "100",
    });
    monthly.findUnique = (async () => ({
      creatorMinutesUsed: 98,
      premiumGenerationsUsed: 0,
    })) as typeof monthly.findUnique;
    const { canConsumeCreatorMinutes } = await import("./services/creator-quota.service");
    const blocked = await canConsumeCreatorMinutes("pro-user", 3);
    assert.equal(blocked.ok, false);
    const ok = await canConsumeCreatorMinutes("pro-user", 2);
    assert.equal(ok.ok, true);
    monthly.findUnique = origFind;
  });

  await t.test("consumeCreatorMinutes skips upsert for free tier (limit 0)", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "true",
      ENTITLEMENT_DEFAULT_PLAN_TIER: "free",
    });
    let upserts = 0;
    monthly.upsert = (async () => {
      upserts += 1;
      return {} as never;
    }) as typeof monthly.upsert;
    const { consumeCreatorMinutes } = await import("./services/creator-quota.service");
    await consumeCreatorMinutes("user-free", 10);
    assert.equal(upserts, 0);
    monthly.upsert = origUpsert;
  });

  await t.test("consumeCreatorMinutes skips when enforcement disabled", async () => {
    loadMinimalEnv({
      ENTITLEMENT_ENFORCEMENT_ENABLED: "false",
      ENTITLEMENT_PRO_USER_IDS: "pro-user",
    });
    let upserts = 0;
    monthly.upsert = (async () => {
      upserts += 1;
      return {} as never;
    }) as typeof monthly.upsert;
    const { consumeCreatorMinutes } = await import("./services/creator-quota.service");
    await consumeCreatorMinutes("pro-user", 5);
    assert.equal(upserts, 0);
    monthly.upsert = origUpsert;
  });

  monthly.findUnique = origFind;
  monthly.upsert = origUpsert;
  billing.findUnique = origBillingFind;
});

test("credit-wallet.service", async (t) => {
  const wallet = prisma.userCreditWallet as unknown as {
    findUnique: typeof prisma.userCreditWallet.findUnique;
  };
  const origFind = wallet.findUnique.bind(wallet);
  const origTx = prisma.$transaction.bind(prisma);

  await t.test("canConsumeRenderCredits false when balance too low", async () => {
    loadMinimalEnv({});
    wallet.findUnique = (async () => ({
      id: "w1",
      renderCreditsBalance: 1,
      bonusCreditsBalance: null,
    })) as typeof wallet.findUnique;
    const { canConsumeRenderCredits } = await import("./services/credit-wallet.service");
    const r = await canConsumeRenderCredits("u1", 3);
    assert.equal(r.ok, false);
    assert.equal(r.balance, 1);
    wallet.findUnique = origFind;
  });

  await t.test("consumeRenderCredits throws when wallet debit insufficient", async () => {
    loadMinimalEnv({});
    prisma.$transaction = (async (arg: unknown) => {
      const fn = arg as (tx: {
        userCreditWallet: {
          findUnique: () => Promise<{ renderCreditsBalance: number } | null>;
          update: () => Promise<{ renderCreditsBalance: number }>;
        };
        userCreditLedgerEntry: { create: () => Promise<unknown> };
      }) => Promise<{ ok: boolean; balance?: number }>;
      const mockTx = {
        userCreditWallet: {
          findUnique: async () => ({ renderCreditsBalance: 0 }),
          update: async () => ({ renderCreditsBalance: 0 }),
        },
        userCreditLedgerEntry: {
          create: async () => ({}),
        },
      };
      return fn(mockTx as never);
    }) as typeof prisma.$transaction;

    const { consumeRenderCredits } = await import("./services/credit-wallet.service");
    await assert.rejects(
      () => consumeRenderCredits("u1", 1),
      (err: unknown) => err instanceof AppError && err.statusCode === 402,
    );
    prisma.$transaction = origTx;
  });

  wallet.findUnique = origFind;
  prisma.$transaction = origTx;
});

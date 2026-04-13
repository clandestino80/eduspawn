import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../config/env";
import { AppError } from "../../lib/errors";
import {
  assertCreatorDurationForPack,
  computeDurationBand,
  describePlanPath,
  estimateCreatorMinutesForLongPack,
  resolvePackKindFromGoal,
} from "./creator-plan";

const MIN_ENV = {
  JWT_SECRET: "j".repeat(32),
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x?sslmode=require",
  NODE_ENV: "test",
} as const;

function loadEnv(overrides: Record<string, string>): void {
  resetEnvCacheForTests();
  for (const [k, v] of Object.entries(MIN_ENV)) {
    process.env[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  resetEnvCacheForTests();
}

test("creator-plan", async (t) => {
  await t.test("resolvePackKind: long_form on free → 403", () => {
    assert.throws(
      () => resolvePackKindFromGoal("long_form_creator_pack", "free"),
      (e: unknown) => e instanceof AppError && e.statusCode === 403 && e.code === "CREATOR_PLAN_BLOCKED",
    );
  });

  await t.test("resolvePackKind: long_form on pro → LONG_FORM", () => {
    const k = resolvePackKindFromGoal("long_form_creator_pack", "pro");
    assert.equal(k, "LONG_FORM");
  });

  await t.test("resolvePackKind: short_video → SHORT_FORM", () => {
    assert.equal(resolvePackKindFromGoal("short_video", "free"), "SHORT_FORM");
  });

  await t.test("free short duration over FREE_CREATOR_MAX_DURATION_SEC → 400", () => {
    loadEnv({ FREE_CREATOR_MAX_DURATION_SEC: "90" });
    assert.throws(
      () =>
        assertCreatorDurationForPack({
          packKind: "SHORT_FORM",
          durationSec: 120,
          planTier: "free",
        }),
      (e: unknown) => e instanceof AppError && e.code === "CREATOR_DURATION_NOT_ALLOWED",
    );
  });

  await t.test("short pack over 300s → 400", () => {
    loadEnv({ FREE_CREATOR_MAX_DURATION_SEC: "300" });
    assert.throws(
      () =>
        assertCreatorDurationForPack({
          packKind: "SHORT_FORM",
          durationSec: 400,
          planTier: "premium",
        }),
      (e: unknown) => e instanceof AppError && e.code === "CREATOR_DURATION_NOT_ALLOWED",
    );
  });

  await t.test("computeDurationBand short buckets", () => {
    assert.equal(computeDurationBand(12, "SHORT_FORM"), "short_lte_15");
    assert.equal(computeDurationBand(45, "SHORT_FORM"), "short_lte_60");
    assert.equal(computeDurationBand(200, "LONG_FORM"), "long_lte_300");
  });

  await t.test("describePlanPath", () => {
    assert.equal(describePlanPath({ planTier: "free", packKind: "SHORT_FORM" }), "free_short");
    assert.equal(describePlanPath({ planTier: "pro", packKind: "LONG_FORM" }), "pro_long");
  });

  await t.test("estimateCreatorMinutesForLongPack", () => {
    assert.equal(estimateCreatorMinutesForLongPack(45), 1);
    assert.equal(estimateCreatorMinutesForLongPack(120), 2);
    assert.equal(estimateCreatorMinutesForLongPack(3600), 30);
  });
});

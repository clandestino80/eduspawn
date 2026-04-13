import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../config/env";
import { computeCreatorMinuteDebit } from "./creator-minute-policy";

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

test("creator-minute-policy", async (t) => {
  await t.test("fresh generation: full base minutes", () => {
    loadEnv({ CREATOR_REUSE_MINUTE_DISCOUNT_PERCENT: "50" });
    assert.equal(computeCreatorMinuteDebit({ baseMinutes: 4, isReuseFromGlobal: false }), 4);
  });

  await t.test("reuse: 50% discount rounded up, min 1", () => {
    loadEnv({ CREATOR_REUSE_MINUTE_DISCOUNT_PERCENT: "50" });
    assert.equal(computeCreatorMinuteDebit({ baseMinutes: 4, isReuseFromGlobal: true }), 2);
    assert.equal(computeCreatorMinuteDebit({ baseMinutes: 1, isReuseFromGlobal: true }), 1);
  });

  await t.test("reuse: 25% discount", () => {
    loadEnv({ CREATOR_REUSE_MINUTE_DISCOUNT_PERCENT: "25" });
    assert.equal(computeCreatorMinuteDebit({ baseMinutes: 4, isReuseFromGlobal: true }), 3);
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../config/env";
import { computeCreatorPackRenderCreditCost } from "./services/render-credit-policy";

function applyEnv(overrides: Record<string, string>): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "f".repeat(32);
  process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  resetEnvCacheForTests();
}

test("render credit policy", async (t) => {
  await t.test("short pack uses RENDER_CREATOR_PACK_SHORT_CREDIT_COST (min 1)", () => {
    applyEnv({
      RENDER_CREATOR_PACK_SHORT_CREDIT_COST: "3",
      RENDER_CREATOR_PACK_LONG_CREDIT_COST: "5",
    });
    assert.equal(computeCreatorPackRenderCreditCost("SHORT_FORM"), 3);
  });

  await t.test("long pack uses RENDER_CREATOR_PACK_LONG_CREDIT_COST (min 1)", () => {
    applyEnv({
      RENDER_CREATOR_PACK_SHORT_CREDIT_COST: "1",
      RENDER_CREATOR_PACK_LONG_CREDIT_COST: "7",
    });
    assert.equal(computeCreatorPackRenderCreditCost("LONG_FORM"), 7);
  });
});

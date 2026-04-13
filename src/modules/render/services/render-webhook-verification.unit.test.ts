import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../../config/env";
import { AppError } from "../../../lib/errors";
import { assertWebhookClockSkew } from "./render-webhook-verification";

test("assertWebhookClockSkew", async (t) => {
  await t.test("allows missing timestamp", () => {
    resetEnvCacheForTests();
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "f".repeat(32);
    process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";
    process.env.RENDER_WEBHOOK_MAX_CLOCK_SKEW_SEC = "600";
    resetEnvCacheForTests();
    assertWebhookClockSkew({ get: () => undefined });
  });

  await t.test("rejects very old timestamp", () => {
    resetEnvCacheForTests();
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "f".repeat(32);
    process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";
    process.env.RENDER_WEBHOOK_MAX_CLOCK_SKEW_SEC = "120";
    resetEnvCacheForTests();
    const stale = String(Math.floor(Date.now() / 1000) - 10_000);
    assert.throws(
      () => assertWebhookClockSkew({ get: (n) => (n.toLowerCase() === "x-webhook-timestamp" ? stale : undefined) }),
      (e) => e instanceof AppError && e.code === "RENDER_WEBHOOK_STALE",
    );
  });
});

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import type { Express } from "express";

import { createApp } from "../../app";
import { resetEnvCacheForTests } from "../../config/env";
import { resetSlidingWindowLimitersForTests } from "../../lib/in-memory-rate-limiter";
import { signAccessToken } from "../../lib/jwt";

const JWT_SECRET = "f".repeat(32);
const DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";

function applyTestEnv(overrides: Record<string, string | undefined>): void {
  resetSlidingWindowLimitersForTests();
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DATABASE_URL = DATABASE_URL;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  resetEnvCacheForTests();
}

async function httpPostJson(
  app: Express,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        server.close(() => reject(new Error("invalid listen address")));
        return;
      }
      const { port } = addr;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            const json = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
            server.close(() => resolve({ status: res.statusCode ?? 0, json }));
          });
        },
      );
      req.on("error", (err) => server.close(() => reject(err)));
      req.write(payload);
      req.end();
    });
  });
}

test("billing checkout routes", async (t) => {
  await t.test("POST subscription without auth → 401", async () => {
    applyTestEnv({
      STRIPE_SECRET_KEY: undefined,
    });
    const app = createApp();
    const { status, json } = await httpPostJson(app, "/api/v1/billing/checkout/subscription", {}, {
      planTier: "pro",
    });
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("POST subscription with auth but Stripe not configured → 503", async () => {
    applyTestEnv({
      STRIPE_SECRET_KEY: undefined,
      STRIPE_CHECKOUT_SUCCESS_URL: "https://example.com/ok",
      STRIPE_CHECKOUT_CANCEL_URL: "https://example.com/cancel",
    });
    const app = createApp();
    const token = signAccessToken({
      sub: "checkout-user-1",
      email: "c@example.com",
      username: "checkoutuser",
    });
    const { status, json } = await httpPostJson(
      app,
      "/api/v1/billing/checkout/subscription",
      { Authorization: `Bearer ${token}` },
      { planTier: "pro" },
    );
    assert.equal(status, 503);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.error?.code, "BILLING_STRIPE_NOT_CONFIGURED");
  });

  await t.test("invalid plan tier → 400", async () => {
    applyTestEnv({
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_CHECKOUT_SUCCESS_URL: "https://example.com/ok",
      STRIPE_CHECKOUT_CANCEL_URL: "https://example.com/cancel",
    });
    const app = createApp();
    const token = signAccessToken({
      sub: "checkout-user-2",
      email: "c2@example.com",
      username: "checkoutuser2",
    });
    const { status, json } = await httpPostJson(
      app,
      "/api/v1/billing/checkout/subscription",
      { Authorization: `Bearer ${token}` },
      { planTier: "enterprise" },
    );
    assert.equal(status, 400);
    const body = json as { error?: { code?: string } };
    assert.equal(body.error?.code, "VALIDATION_ERROR");
  });
});

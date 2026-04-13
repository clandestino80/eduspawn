import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import type { Express } from "express";

import { createApp } from "../../app";
import { resetEnvCacheForTests } from "../../config/env";
import { signAccessToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";

const JWT_SECRET = "f".repeat(32);
const DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";
const OPS_SUB = "opsbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TARGET_USER_ID = "targetuserforbillingops00001";

function applyTestEnv(): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DATABASE_URL = DATABASE_URL;
  delete process.env.BILLING_OPS_ALLOWED_USER_IDS;
  delete process.env.BILLING_OPS_ALLOWED_EMAILS;
  resetEnvCacheForTests();
}

async function httpJsonPost(
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

test("billing ops routes", async (t) => {
  await t.test("unauthenticated POST entitlement → 401", async () => {
    applyTestEnv();
    const app = createApp();
    const { status, json } = await httpJsonPost(
      app,
      `/api/v1/ops/billing/users/${TARGET_USER_ID}/billing/entitlement`,
      {},
      { planTier: "pro", subscriptionStatus: "ACTIVE" },
    );
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("authenticated but not allow-listed → 403", async () => {
    applyTestEnv();
    process.env.BILLING_OPS_ALLOWED_USER_IDS = "someone-else";
    resetEnvCacheForTests();
    const app = createApp();
    const token = signAccessToken({
      sub: OPS_SUB,
      email: "ops@example.com",
      username: "opsuser",
    });
    const { status, json } = await httpJsonPost(
      app,
      `/api/v1/ops/billing/users/${TARGET_USER_ID}/billing/entitlement`,
      { Authorization: `Bearer ${token}` },
      { planTier: "pro", subscriptionStatus: "ACTIVE" },
    );
    assert.equal(status, 403);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.error?.code, "BILLING_OPS_FORBIDDEN");
  });

  await t.test("allow-listed operator + stubbed persistence → 200", async () => {
    applyTestEnv();
    process.env.BILLING_OPS_ALLOWED_USER_IDS = OPS_SUB;
    resetEnvCacheForTests();

    const users = prisma.user as unknown as {
      findUnique: typeof prisma.user.findUnique;
    };
    const origUserFind = users.findUnique.bind(users);
    users.findUnique = (async () => ({ id: TARGET_USER_ID })) as typeof users.findUnique;

    const be = prisma.userBillingEntitlement as unknown as {
      upsert: typeof prisma.userBillingEntitlement.upsert;
    };
    const origUpsert = be.upsert.bind(be);
    be.upsert = (async () => ({
      planTier: "PRO",
      subscriptionStatus: "ACTIVE",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      entitlementSource: "MANUAL",
    })) as typeof be.upsert;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: OPS_SUB,
        email: "ops@example.com",
        username: "opsuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        `/api/v1/ops/billing/users/${TARGET_USER_ID}/billing/entitlement`,
        { Authorization: `Bearer ${token}` },
        { planTier: "pro", subscriptionStatus: "ACTIVE", entitlementSource: "MANUAL" },
      );
      assert.equal(status, 200);
      const body = json as { success?: boolean; data?: { planTier?: string } };
      assert.equal(body.success, true);
      assert.equal(body.data?.planTier, "pro");
    } finally {
      users.findUnique = origUserFind;
      be.upsert = origUpsert;
    }
  });
});

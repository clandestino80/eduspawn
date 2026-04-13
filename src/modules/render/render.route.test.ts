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

function applyTestEnv(overrides: Record<string, string | undefined> = {}): void {
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

async function httpGet(
  app: Express,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: unknown }> {
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
          method: "GET",
          headers,
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
      req.end();
    });
  });
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

test("render routes", async (t) => {
  await t.test("POST /api/v1/render/jobs without auth → 401", async () => {
    applyTestEnv();
    const app = createApp();
    const { status, json } = await httpPostJson(app, "/api/v1/render/jobs", {}, { creatorPackId: "invalid" });
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("GET /api/v1/render/jobs without auth → 401", async () => {
    applyTestEnv();
    const app = createApp();
    const { status, json } = await httpGet(app, "/api/v1/render/jobs", {});
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("POST /api/v1/render/jobs with auth but invalid body → 400", async () => {
    applyTestEnv();
    const app = createApp();
    const token = signAccessToken({
      sub: "render-route-user",
      email: "rr@example.com",
      username: "rruser",
    });
    const { status, json } = await httpPostJson(
      app,
      "/api/v1/render/jobs",
      { Authorization: `Bearer ${token}` },
      { creatorPackId: "not-a-cuid", useEditedPack: false },
    );
    assert.equal(status, 400);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "VALIDATION_ERROR");
  });

  await t.test("POST /api/v1/render/webhooks/provider without configured secret → 503", async () => {
    applyTestEnv({ RENDER_WEBHOOK_SECRET: undefined });
    const app = createApp();
    const { status, json } = await httpPostJson(app, "/api/v1/render/webhooks/provider", {}, {
      provider: "KLING_STUB",
      providerJobId: "stub-x",
      status: "PROCESSING",
    });
    assert.equal(status, 503);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "RENDER_WEBHOOK_DISABLED");
  });

  await t.test("POST /api/v1/render/webhooks/provider with wrong secret → 401", async () => {
    applyTestEnv({ RENDER_WEBHOOK_SECRET: "correctsecretvalue" });
    const app = createApp();
    const { status, json } = await httpPostJson(
      app,
      "/api/v1/render/webhooks/provider",
      { "x-eduspawn-render-webhook-secret": "wrongsecretvalue" },
      {
        provider: "KLING_STUB",
        providerJobId: "stub-x",
        status: "PROCESSING",
      },
    );
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "RENDER_WEBHOOK_UNAUTHORIZED");
  });

  await t.test("POST webhook rejects stale X-Webhook-Timestamp when skew window enabled", async () => {
    applyTestEnv({
      RENDER_WEBHOOK_SECRET: "correctsecretvalue",
      RENDER_WEBHOOK_MAX_CLOCK_SKEW_SEC: "120",
    });
    const app = createApp();
    const stale = String(Math.floor(Date.now() / 1000) - 99999);
    const { status, json } = await httpPostJson(
      app,
      "/api/v1/render/webhooks/provider",
      {
        "x-eduspawn-render-webhook-secret": "correctsecretvalue",
        "x-webhook-timestamp": stale,
      },
      {
        task_id: "any-task",
        status: "completed",
        video: { url: "https://example.com/x.mp4" },
      },
    );
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "RENDER_WEBHOOK_STALE");
  });

  await t.test("POST webhook accepts Kling-native body shape when secret valid (unknown task → 404)", async () => {
    applyTestEnv({
      RENDER_WEBHOOK_SECRET: "correctsecretvalue",
      RENDER_WEBHOOK_MAX_CLOCK_SKEW_SEC: "0",
    });
    const app = createApp();
    const { status, json } = await httpPostJson(
      app,
      "/api/v1/render/webhooks/provider",
      { "x-eduspawn-render-webhook-secret": "correctsecretvalue" },
      {
        task_id: "unknown-kling-task-id-xyz",
        status: "completed",
        video: { url: "https://example.com/x.mp4" },
      },
    );
    assert.equal(status, 404);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "NOT_FOUND");
  });
});

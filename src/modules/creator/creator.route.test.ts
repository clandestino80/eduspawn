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

function applyTestEnv(): void {
  resetSlidingWindowLimitersForTests();
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.ENTITLEMENT_ENFORCEMENT_ENABLED = "false";
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

test("creator routes", async (t) => {
  await t.test("POST /api/v1/creator/generate without auth → 401", async () => {
    applyTestEnv();
    const app = createApp();
    const { status, json } = await httpPostJson(app, "/api/v1/creator/generate", {}, {});
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("GET /api/v1/creator/capacity without auth → 401", async () => {
    applyTestEnv();
    const app = createApp();
    const { status, json } = await httpGet(app, "/api/v1/creator/capacity", {});
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("POST /api/v1/creator/generate with auth but invalid body → 400", async () => {
    applyTestEnv();
    const app = createApp();
    const token = signAccessToken({
      sub: "creator-route-user",
      email: "cr@example.com",
      username: "cruser",
    });
    const { status, json } = await httpPostJson(
      app,
      "/api/v1/creator/generate",
      { Authorization: `Bearer ${token}` },
      { topic: "" },
    );
    assert.equal(status, 400);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "VALIDATION_ERROR");
  });
});

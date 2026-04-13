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
const USER_SUB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function applyTestEnv(): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DATABASE_URL = DATABASE_URL;
  resetEnvCacheForTests();
}

async function httpJson(
  app: Express,
  pathWithQuery: string,
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
          path: pathWithQuery,
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

type StateFindMany = typeof prisma.userTopicState.findMany;

test("GET /api/v1/knowledge-engine/topics/saved", async (t) => {
  await t.test("unauthenticated → 401", async () => {
    applyTestEnv();
    const st = prisma.userTopicState as unknown as { findMany: StateFindMany };
    const orig = st.findMany.bind(st);
    st.findMany = (async () => []) as StateFindMany;
    try {
      const app = createApp();
      const { status } = await httpJson(app, "/api/v1/knowledge-engine/topics/saved", {});
      assert.equal(status, 401);
    } finally {
      st.findMany = orig;
    }
  });

  await t.test("returns saved topics with savedAt", async () => {
    applyTestEnv();
    const st = prisma.userTopicState as unknown as { findMany: StateFindMany };
    const orig = st.findMany.bind(st);
    const savedAt = new Date("2026-02-02T12:00:00.000Z");
    st.findMany = (async (args: Record<string, unknown>) => {
      assert.equal((args.where as { userId?: string })?.userId, USER_SUB);
      if (args.include) {
        return [
          {
            savedAt,
            globalTopic: {
              id: "clsavedtopic00001",
              title: "Saved topic",
              curiosityHook: "Why?",
              shortSummary: "Summary",
              domain: "science",
              subdomain: "waves",
              microTopic: null,
              categoryLabel: null,
              globalConcept: null,
            },
          },
        ] as Awaited<ReturnType<StateFindMany>>;
      }
      return [
        {
          globalTopicId: "clsavedtopic00001",
          generatedAt: null,
          dismissedAt: null,
          openedAt: null,
          savedAt,
          lastSeenAt: null,
          firstSeenAt: null,
          seenCount: 0,
          lastInteractionType: "SAVED",
        },
      ] as Awaited<ReturnType<StateFindMany>>;
    }) as StateFindMany;
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "saved@example.com",
        username: "saveduser",
      });
      const { status, json } = await httpJson(app, "/api/v1/knowledge-engine/topics/saved?limit=5", {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(status, 200);
      const body = json as {
        success?: boolean;
        data?: { topics?: { id: string; title: string; savedAt: string }[] };
      };
      assert.equal(body.success, true);
      assert.equal(body.data?.topics?.length, 1);
      assert.equal(body.data?.topics?.[0]?.id, "clsavedtopic00001");
      assert.equal(body.data?.topics?.[0]?.title, "Saved topic");
      assert.ok(body.data?.topics?.[0]?.savedAt?.includes("2026-02-02"));
    } finally {
      st.findMany = orig;
    }
  });
});

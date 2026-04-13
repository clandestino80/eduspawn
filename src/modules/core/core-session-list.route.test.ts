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
const USER_SUB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function applyTestEnv(): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DATABASE_URL = DATABASE_URL;
  resetEnvCacheForTests();
}

async function httpJsonGet(
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

test("GET /api/v1/core/sessions", async (t) => {
  await t.test("unauthenticated → 401", async () => {
    applyTestEnv();
    const app = createApp();
    const { status, json } = await httpJsonGet(app, "/api/v1/core/sessions", {});
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("lists sessions for user with limit and nextCursor", async () => {
    applyTestEnv();
    const ls = prisma.learningSession as unknown as {
      findMany: typeof prisma.learningSession.findMany;
    };
    const orig = ls.findMany.bind(ls);
    let capturedWhere: unknown;
    let capturedTake: unknown;
    const t1 = new Date("2026-02-02T12:00:00.000Z");
    const t2 = new Date("2026-02-01T12:00:00.000Z");
    ls.findMany = (async (args: { where?: unknown; take?: number }) => {
      capturedWhere = args.where;
      capturedTake = args.take;
      return [
        {
          id: "s-newer",
          userId: USER_SUB,
          topic: "A",
          curiosityPrompt: "why a",
          difficulty: null,
          tone: null,
          status: "generated",
          lessonTitle: "Title A",
          lessonSummary: "Sum A",
          lessonBody: "Body A",
          sourceGlobalTopicId: null,
          createdAt: t1,
          updatedAt: t1,
        },
        {
          id: "s-older",
          userId: USER_SUB,
          topic: "B",
          curiosityPrompt: "why b",
          difficulty: "beginner",
          tone: "friendly",
          status: "created",
          lessonTitle: null,
          lessonSummary: null,
          lessonBody: null,
          sourceGlobalTopicId: "cltopic0000000000001",
          createdAt: t2,
          updatedAt: t2,
        },
      ] as Awaited<ReturnType<typeof prisma.learningSession.findMany>>;
    }) as typeof ls.findMany;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "list@example.com",
        username: "listuser",
      });
      const { status, json } = await httpJsonGet(app, "/api/v1/core/sessions?limit=1", {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(status, 200);
      const w = capturedWhere as { userId?: string };
      assert.equal(w.userId, USER_SUB);
      assert.equal(capturedTake, 2);
      const body = json as {
        success?: boolean;
        data?: { sessions?: { id: string }[]; nextCursor?: string | null };
      };
      assert.equal(body.success, true);
      assert.equal(body.data?.sessions?.length, 1);
      assert.equal(body.data?.sessions?.[0]?.id, "s-newer");
      assert.ok(typeof body.data?.nextCursor === "string" && (body.data?.nextCursor?.length ?? 0) > 0);
    } finally {
      ls.findMany = orig;
    }
  });

  await t.test("invalid cursor → 400", async () => {
    applyTestEnv();
    const ls = prisma.learningSession as unknown as {
      findMany: typeof prisma.learningSession.findMany;
    };
    const orig = ls.findMany.bind(ls);
    ls.findMany = (async () => []) as typeof ls.findMany;
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "list@example.com",
        username: "listuser",
      });
      const { status, json } = await httpJsonGet(
        app,
        "/api/v1/core/sessions?cursor=not-a-valid-cursor",
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(status, 400);
      const body = json as { success?: boolean; error?: { code?: string } };
      assert.equal(body.success, false);
      assert.equal(body.error?.code, "INVALID_CURSOR");
    } finally {
      ls.findMany = orig;
    }
  });
});

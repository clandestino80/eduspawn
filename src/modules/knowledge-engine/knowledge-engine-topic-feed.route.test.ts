import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import type { Express } from "express";

import { createApp } from "../../app";
import { resetEnvCacheForTests } from "../../config/env";
import { signAccessToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { clearTopicFeedCacheForTests } from "./services/topic-feed-cache.service";

const JWT_SECRET = "f".repeat(32);
const DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";
const FEED_USER_SUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function applyTestEnv(): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DATABASE_URL = DATABASE_URL;
  delete process.env.KNOWLEDGE_OPS_ALLOWED_USER_IDS;
  delete process.env.KNOWLEDGE_OPS_ALLOWED_EMAILS;
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

type InvFindMany = typeof prisma.globalTopicInventory.findMany;
type StateFindMany = typeof prisma.userTopicState.findMany;

function installFeedReadStubs(options: {
  inventory: Awaited<ReturnType<InvFindMany>>;
  states: Awaited<ReturnType<StateFindMany>>;
  onInventoryFindMany?: (args: unknown) => void;
  onStateFindMany?: (args: unknown) => void;
}): () => void {
  const inv = prisma.globalTopicInventory as unknown as { findMany: InvFindMany };
  const st = prisma.userTopicState as unknown as { findMany: StateFindMany };
  const origInv = inv.findMany.bind(inv);
  const origSt = st.findMany.bind(st);
  inv.findMany = (async (args: Parameters<InvFindMany>[0]) => {
    options.onInventoryFindMany?.(args);
    return options.inventory;
  }) as InvFindMany;
  st.findMany = (async (args: Parameters<StateFindMany>[0]) => {
    options.onStateFindMany?.(args);
    return options.states;
  }) as StateFindMany;
  return () => {
    inv.findMany = origInv;
    st.findMany = origSt;
  };
}

const baseInventoryRow = (overrides: Record<string, unknown>) =>
  ({
    id: "topic-1",
    normalizedKey: "key-1",
    title: "T1",
    curiosityHook: null,
    shortSummary: null,
    domain: "Science",
    subdomain: "Physics",
    microTopic: null,
    categoryLabel: null,
    sourceType: "SYSTEM_SEED",
    status: "ACTIVE",
    sourceUserId: null,
    sourceLearningSessionId: null,
    globalConceptId: null,
    qualityScore: null,
    reuseEligible: true,
    freshnessBucket: null,
    timesSuggested: 0,
    timesOpened: 0,
    timesGenerated: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    globalConcept: null,
    ...overrides,
  }) as Awaited<ReturnType<InvFindMany>>[number];

test("GET /api/v1/knowledge-engine/topics/feed", async (t) => {
  await t.test("unauthenticated → 401", async () => {
    applyTestEnv();
    const uninstall = installFeedReadStubs({
      inventory: [],
      states: [],
    });
    try {
      const app = createApp();
      const { status, json } = await httpJson(app, "/api/v1/knowledge-engine/topics/feed", {});
      assert.equal(status, 401);
      const body = json as { success?: boolean; error?: { code?: string } };
      assert.equal(body.success, false);
      assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
    } finally {
      uninstall();
    }
  });

  await t.test("authenticated, empty inventory → 200 and empty topics", async () => {
    applyTestEnv();
    let stateCalls = 0;
    const uninstall = installFeedReadStubs({
      inventory: [],
      states: [],
      onStateFindMany: () => {
        stateCalls += 1;
      },
    });
    const daily = prisma.userGenerationUsageDaily as unknown as {
      upsert: typeof prisma.userGenerationUsageDaily.upsert;
    };
    const origDailyUpsert = daily.upsert.bind(daily);
    daily.upsert = (async () => {
      throw new Error("UserGenerationUsageDaily must not be written from topic feed (read-only)");
    }) as typeof daily.upsert;
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: FEED_USER_SUB,
        email: "feed@example.com",
        username: "feeduser",
      });
      const { status, json } = await httpJson(app, "/api/v1/knowledge-engine/topics/feed", {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(status, 200);
      const body = json as { success?: boolean; data?: { topics?: unknown[] } };
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data?.topics));
      assert.equal(body.data?.topics?.length, 0);
      assert.equal(stateCalls, 0);
    } finally {
      daily.upsert = origDailyUpsert;
      uninstall();
    }
  });

  await t.test("excludes user-generated topics and respects limit", async () => {
    applyTestEnv();
    const rows = [
      baseInventoryRow({
        id: "t-generated",
        normalizedKey: "a",
        title: "Generated",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
      baseInventoryRow({
        id: "t-open",
        normalizedKey: "b",
        title: "Open",
        createdAt: new Date("2026-01-15T00:00:00.000Z"),
      }),
      baseInventoryRow({
        id: "t-fresh",
        normalizedKey: "c",
        title: "Fresh",
        createdAt: new Date("2026-01-10T00:00:00.000Z"),
      }),
    ];
    const states = [
      {
        globalTopicId: "t-generated",
        generatedAt: new Date("2026-03-01T00:00:00.000Z"),
        dismissedAt: null,
        lastSeenAt: null,
        firstSeenAt: null,
        seenCount: 0,
        lastInteractionType: null as const,
      },
    ] as unknown as Awaited<ReturnType<StateFindMany>>;
    const uninstall = installFeedReadStubs({ inventory: rows, states });
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: FEED_USER_SUB,
        email: "feed@example.com",
        username: "feeduser",
      });
      const { status, json } = await httpJson(
        app,
        "/api/v1/knowledge-engine/topics/feed?limit=1",
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(status, 200);
      const body = json as { data?: { topics?: { id: string; title: string }[] } };
      assert.equal(body.data?.topics?.length, 1);
      assert.equal(body.data?.topics?.[0]?.id, "t-open");
      assert.equal(body.data?.topics?.[0]?.title, "Open");
    } finally {
      uninstall();
    }
  });

  await t.test("domain filter forwarded to inventory query", async () => {
    applyTestEnv();
    let captured: unknown;
    const rows = [baseInventoryRow({ id: "x1", normalizedKey: "x", domain: "Math" })];
    const uninstall = installFeedReadStubs({
      inventory: rows,
      states: [],
      onInventoryFindMany: (args) => {
        captured = args;
      },
    });
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: FEED_USER_SUB,
        email: "feed@example.com",
        username: "feeduser",
      });
      const { status } = await httpJson(
        app,
        "/api/v1/knowledge-engine/topics/feed?domain=Math&subdomain=Algebra",
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(status, 200);
      const w = captured as { where?: { domain?: string; subdomain?: string } };
      assert.equal(w.where?.domain, "Math");
      assert.equal(w.where?.subdomain, "Algebra");
    } finally {
      uninstall();
    }
  });

  await t.test("excludes lastInteractionType GENERATED even when generatedAt is null", async () => {
    applyTestEnv();
    const rows = [
      baseInventoryRow({ id: "g-flag", normalizedKey: "gf", title: "Flagged" }),
      baseInventoryRow({ id: "g-keep", normalizedKey: "gk", title: "Keep" }),
    ];
    const states = [
      {
        globalTopicId: "g-flag",
        generatedAt: null,
        dismissedAt: null,
        lastSeenAt: null,
        firstSeenAt: null,
        seenCount: 0,
        lastInteractionType: "GENERATED" as const,
      },
    ] as unknown as Awaited<ReturnType<StateFindMany>>;
    const uninstall = installFeedReadStubs({ inventory: rows, states });
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: FEED_USER_SUB,
        email: "feed@example.com",
        username: "feeduser",
      });
      const { status, json } = await httpJson(app, "/api/v1/knowledge-engine/topics/feed", {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(status, 200);
      const body = json as { data?: { topics?: { id: string }[] } };
      assert.equal(body.data?.topics?.length, 1);
      assert.equal(body.data?.topics?.[0]?.id, "g-keep");
    } finally {
      uninstall();
    }
  });

  await t.test("excludes dismissed and very recently seen", async () => {
    applyTestEnv();
    const rows = [
      baseInventoryRow({ id: "d1", normalizedKey: "d1", title: "Dismissed" }),
      baseInventoryRow({ id: "r1", normalizedKey: "r1", title: "Recent" }),
      baseInventoryRow({ id: "ok", normalizedKey: "ok", title: "OK" }),
    ];
    const states = [
      {
        globalTopicId: "d1",
        generatedAt: null,
        dismissedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSeenAt: null,
        firstSeenAt: null,
        seenCount: 0,
        lastInteractionType: null as const,
      },
      {
        globalTopicId: "r1",
        generatedAt: null,
        dismissedAt: null,
        lastSeenAt: new Date(),
        firstSeenAt: new Date(),
        seenCount: 2,
        lastInteractionType: "SEEN" as const,
      },
    ] as unknown as Awaited<ReturnType<StateFindMany>>;
    const uninstall = installFeedReadStubs({ inventory: rows, states });
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: FEED_USER_SUB,
        email: "feed@example.com",
        username: "feeduser",
      });
      const { status, json } = await httpJson(app, "/api/v1/knowledge-engine/topics/feed?limit=10", {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(status, 200);
      const body = json as { data?: { topics?: { id: string }[] } };
      assert.equal(body.data?.topics?.length, 1);
      assert.equal(body.data?.topics?.[0]?.id, "ok");
    } finally {
      uninstall();
    }
  });

  await t.test("Slice E: cache hit skips second inventory and topic-state reads; feed stays unmetered", async () => {
    applyTestEnv();
    process.env.TOPIC_FEED_CACHE_ENABLED = "true";
    process.env.TOPIC_FEED_CACHE_TTL_SECONDS = "300";
    resetEnvCacheForTests();
    clearTopicFeedCacheForTests();

    const rows = [baseInventoryRow({ id: "c1", normalizedKey: "c1k", title: "CachedRow" })];
    let invCalls = 0;
    let stateCalls = 0;
    const uninstall = installFeedReadStubs({
      inventory: rows,
      states: [],
      onInventoryFindMany: () => {
        invCalls += 1;
      },
      onStateFindMany: () => {
        stateCalls += 1;
      },
    });
    const daily = prisma.userGenerationUsageDaily as unknown as {
      upsert: typeof prisma.userGenerationUsageDaily.upsert;
    };
    const origDailyUpsert = daily.upsert.bind(daily);
    daily.upsert = (async () => {
      throw new Error("UserGenerationUsageDaily must not be written from topic feed (read-only)");
    }) as typeof daily.upsert;
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: FEED_USER_SUB,
        email: "feed@example.com",
        username: "feeduser",
      });
      const path = "/api/v1/knowledge-engine/topics/feed?limit=5";
      const headers = { Authorization: `Bearer ${token}` };
      const r1 = await httpJson(app, path, headers);
      const r2 = await httpJson(app, path, headers);
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      assert.equal(invCalls, 1);
      assert.equal(stateCalls, 1);
      const body = r2.json as { data?: { topics?: { id: string; title: string }[] } };
      assert.equal(body.data?.topics?.length, 1);
      assert.equal(body.data?.topics?.[0]?.id, "c1");
      assert.equal(body.data?.topics?.[0]?.title, "CachedRow");
    } finally {
      daily.upsert = origDailyUpsert;
      uninstall();
      clearTopicFeedCacheForTests();
      delete process.env.TOPIC_FEED_CACHE_ENABLED;
      delete process.env.TOPIC_FEED_CACHE_TTL_SECONDS;
      resetEnvCacheForTests();
    }
  });
});

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { UserTopicInteractionType } from "@prisma/client";
import type { Express } from "express";

import { createApp } from "../../app";
import { resetEnvCacheForTests } from "../../config/env";
import { signAccessToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { clearTopicFeedCacheForTests } from "./services/topic-feed-cache.service";

const JWT_SECRET = "f".repeat(32);
const DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";
const USER_SUB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOPIC_ID = "cltopicinteractiontest0001";

function applyTestEnv(): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DATABASE_URL = DATABASE_URL;
  delete process.env.KNOWLEDGE_OPS_ALLOWED_USER_IDS;
  delete process.env.KNOWLEDGE_OPS_ALLOWED_EMAILS;
  resetEnvCacheForTests();
}

async function httpJsonPost(
  app: Express,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const payload = body !== undefined ? JSON.stringify(body) : "";
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

test("Slice F — topic interaction POST routes", async (t) => {
  await t.test("unauthenticated open → 401", async () => {
    applyTestEnv();
    const app = createApp();
    const { status, json } = await httpJsonPost(app, `/api/v1/knowledge-engine/topics/${TOPIC_ID}/open`, {});
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("authenticated open writes topic state and does not touch generation usage", async () => {
    applyTestEnv();
    clearTopicFeedCacheForTests();

    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origFindInv = gti.findUnique.bind(gti);
    gti.findUnique = (async () => ({ id: TOPIC_ID })) as typeof gti.findUnique;

    let txCalls = 0;
    const origTx = prisma.$transaction.bind(prisma);
    prisma.$transaction = (async (arg: unknown) => {
      txCalls += 1;
      const fn = arg as (tx: {
        userTopicState: {
          findUnique: () => Promise<null>;
          create: (args: unknown) => Promise<unknown>;
          update: () => Promise<unknown>;
        };
      }) => Promise<void>;
      const mockTx = {
        userTopicState: {
          findUnique: async () => null,
          create: async () => ({}),
          update: async () => {
            throw new Error("unexpected update on open create path");
          },
        },
      };
      await fn(mockTx as never);
      return undefined;
    }) as typeof prisma.$transaction;

    let usageUpserts = 0;
    const daily = prisma.userGenerationUsageDaily as unknown as {
      upsert: typeof prisma.userGenerationUsageDaily.upsert;
    };
    const origDailyUpsert = daily.upsert.bind(daily);
    daily.upsert = (async () => {
      usageUpserts += 1;
      return {} as never;
    }) as typeof daily.upsert;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "topic@example.com",
        username: "topicuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        `/api/v1/knowledge-engine/topics/${TOPIC_ID}/open`,
        { Authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(status, 200);
      const body = json as { success?: boolean; data?: { topicId: string; interaction: string } };
      assert.equal(body.success, true);
      assert.equal(body.data?.topicId, TOPIC_ID);
      assert.equal(body.data?.interaction, "opened");
      assert.equal(txCalls, 1);
      assert.equal(usageUpserts, 0);
    } finally {
      gti.findUnique = origFindInv;
      prisma.$transaction = origTx;
      daily.upsert = origDailyUpsert;
      clearTopicFeedCacheForTests();
    }
  });

  await t.test("authenticated dismiss upserts topic state and does not touch generation usage", async () => {
    applyTestEnv();
    clearTopicFeedCacheForTests();

    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origFindInv = gti.findUnique.bind(gti);
    gti.findUnique = (async () => ({ id: TOPIC_ID })) as typeof gti.findUnique;

    const uts = prisma.userTopicState as unknown as {
      upsert: typeof prisma.userTopicState.upsert;
    };
    const origUpsert = uts.upsert.bind(uts);
    let upserted = false;
    uts.upsert = (async () => {
      upserted = true;
      return {} as never;
    }) as typeof uts.upsert;

    let usageUpserts = 0;
    const daily = prisma.userGenerationUsageDaily as unknown as {
      upsert: typeof prisma.userGenerationUsageDaily.upsert;
    };
    const origDailyUpsert = daily.upsert.bind(daily);
    daily.upsert = (async () => {
      usageUpserts += 1;
      return {} as never;
    }) as typeof daily.upsert;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "topic@example.com",
        username: "topicuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        `/api/v1/knowledge-engine/topics/${TOPIC_ID}/dismiss`,
        { Authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(status, 200);
      const body = json as { data?: { interaction: string } };
      assert.equal(body.data?.interaction, "dismissed");
      assert.equal(upserted, true);
      assert.equal(usageUpserts, 0);
    } finally {
      gti.findUnique = origFindInv;
      uts.upsert = origUpsert;
      daily.upsert = origDailyUpsert;
      clearTopicFeedCacheForTests();
    }
  });

  await t.test("authenticated save upserts topic state", async () => {
    applyTestEnv();
    clearTopicFeedCacheForTests();

    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origFindInv = gti.findUnique.bind(gti);
    gti.findUnique = (async () => ({ id: TOPIC_ID })) as typeof gti.findUnique;

    const uts = prisma.userTopicState as unknown as {
      upsert: typeof prisma.userTopicState.upsert;
    };
    const origUpsert = uts.upsert.bind(uts);
    let upserted = false;
    uts.upsert = (async () => {
      upserted = true;
      return {} as never;
    }) as typeof uts.upsert;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "topic@example.com",
        username: "topicuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        `/api/v1/knowledge-engine/topics/${TOPIC_ID}/save`,
        { Authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(status, 200);
      const body = json as { data?: { interaction: string } };
      assert.equal(body.data?.interaction, "saved");
      assert.equal(upserted, true);
    } finally {
      gti.findUnique = origFindInv;
      uts.upsert = origUpsert;
      clearTopicFeedCacheForTests();
    }
  });

  await t.test("unknown topic id → 404", async () => {
    applyTestEnv();

    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origFindInv = gti.findUnique.bind(gti);
    gti.findUnique = (async () => null) as typeof gti.findUnique;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "topic@example.com",
        username: "topicuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        "/api/v1/knowledge-engine/topics/clnonexistenttopicidxx/open",
        { Authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(status, 404);
      const body = json as { success?: boolean; error?: { code?: string } };
      assert.equal(body.success, false);
      assert.equal(body.error?.code, "TOPIC_NOT_FOUND");
    } finally {
      gti.findUnique = origFindInv;
    }
  });

  await t.test("unauthenticated unsave → 401", async () => {
    applyTestEnv();
    const app = createApp();
    const { status, json } = await httpJsonPost(app, `/api/v1/knowledge-engine/topics/${TOPIC_ID}/unsave`, {});
    assert.equal(status, 401);
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("authenticated unsave clears savedAt, preserves other state, no generation usage", async () => {
    applyTestEnv();
    clearTopicFeedCacheForTests();

    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origFindInv = gti.findUnique.bind(gti);
    gti.findUnique = (async () => ({ id: TOPIC_ID })) as typeof gti.findUnique;

    const openedAt = new Date("2025-06-01T00:00:00.000Z");
    const savedAt = new Date("2026-01-01T00:00:00.000Z");

    const uts = prisma.userTopicState as unknown as {
      findUnique: typeof prisma.userTopicState.findUnique;
      update: typeof prisma.userTopicState.update;
    };
    const origFindUts = uts.findUnique.bind(uts);
    const origUpdateUts = uts.update.bind(uts);
    let updateCalls = 0;
    let lastUpdateData: { savedAt?: unknown; lastInteractionType?: unknown } | undefined;
    uts.findUnique = (async () => ({
      userId: USER_SUB,
      globalTopicId: TOPIC_ID,
      savedAt,
      openedAt,
      dismissedAt: null,
      generatedAt: null,
      lastSeenAt: null,
      firstSeenAt: null,
      seenCount: 2,
      lastInteractionType: UserTopicInteractionType.OPENED,
    })) as typeof uts.findUnique;
    uts.update = (async (args: { data: { savedAt?: unknown; lastInteractionType?: unknown } }) => {
      updateCalls += 1;
      lastUpdateData = args.data;
      return {} as never;
    }) as typeof uts.update;

    let usageUpserts = 0;
    const daily = prisma.userGenerationUsageDaily as unknown as {
      upsert: typeof prisma.userGenerationUsageDaily.upsert;
    };
    const origDailyUpsert = daily.upsert.bind(daily);
    daily.upsert = (async () => {
      usageUpserts += 1;
      return {} as never;
    }) as typeof daily.upsert;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "topic@example.com",
        username: "topicuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        `/api/v1/knowledge-engine/topics/${TOPIC_ID}/unsave`,
        { Authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(status, 200);
      const body = json as { success?: boolean; data?: { topicId: string; interaction: string } };
      assert.equal(body.success, true);
      assert.equal(body.data?.topicId, TOPIC_ID);
      assert.equal(body.data?.interaction, "unsaved");
      assert.equal(updateCalls, 1);
      assert.equal(lastUpdateData?.savedAt, null);
      assert.equal(Object.prototype.hasOwnProperty.call(lastUpdateData, "lastInteractionType"), false);
      assert.equal(usageUpserts, 0);
    } finally {
      gti.findUnique = origFindInv;
      uts.findUnique = origFindUts;
      uts.update = origUpdateUts;
      daily.upsert = origDailyUpsert;
      clearTopicFeedCacheForTests();
    }
  });

  await t.test("authenticated unsave clears lastInteractionType when it was SAVED", async () => {
    applyTestEnv();
    clearTopicFeedCacheForTests();

    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origFindInv = gti.findUnique.bind(gti);
    gti.findUnique = (async () => ({ id: TOPIC_ID })) as typeof gti.findUnique;

    const uts = prisma.userTopicState as unknown as {
      findUnique: typeof prisma.userTopicState.findUnique;
      update: typeof prisma.userTopicState.update;
    };
    const origFindUts = uts.findUnique.bind(uts);
    const origUpdateUts = uts.update.bind(uts);
    let lastUpdateData: { savedAt?: unknown; lastInteractionType?: unknown } | undefined;
    uts.findUnique = (async () => ({
      userId: USER_SUB,
      globalTopicId: TOPIC_ID,
      savedAt: new Date(),
      openedAt: null,
      dismissedAt: null,
      generatedAt: null,
      lastSeenAt: null,
      firstSeenAt: null,
      seenCount: 0,
      lastInteractionType: UserTopicInteractionType.SAVED,
    })) as typeof uts.findUnique;
    uts.update = (async (args: { data: { savedAt?: unknown; lastInteractionType?: unknown } }) => {
      lastUpdateData = args.data;
      return {} as never;
    }) as typeof uts.update;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "topic@example.com",
        username: "topicuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        `/api/v1/knowledge-engine/topics/${TOPIC_ID}/unsave`,
        { Authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(status, 200);
      const body = json as { data?: { interaction: string } };
      assert.equal(body.data?.interaction, "unsaved");
      assert.equal(lastUpdateData?.savedAt, null);
      assert.equal(lastUpdateData?.lastInteractionType, null);
    } finally {
      gti.findUnique = origFindInv;
      uts.findUnique = origFindUts;
      uts.update = origUpdateUts;
      clearTopicFeedCacheForTests();
    }
  });

  await t.test("unsave is idempotent when no row or already unsaved (no update)", async () => {
    applyTestEnv();
    clearTopicFeedCacheForTests();

    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origFindInv = gti.findUnique.bind(gti);
    gti.findUnique = (async () => ({ id: TOPIC_ID })) as typeof gti.findUnique;

    const uts = prisma.userTopicState as unknown as {
      findUnique: typeof prisma.userTopicState.findUnique;
      update: typeof prisma.userTopicState.update;
    };
    const origFindUts = uts.findUnique.bind(uts);
    const origUpdateUts = uts.update.bind(uts);
    let updateCalls = 0;
    uts.findUnique = (async () => null) as typeof uts.findUnique;
    uts.update = (async () => {
      updateCalls += 1;
      return {} as never;
    }) as typeof uts.update;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "topic@example.com",
        username: "topicuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        `/api/v1/knowledge-engine/topics/${TOPIC_ID}/unsave`,
        { Authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(status, 200);
      const body = json as { data?: { interaction: string } };
      assert.equal(body.data?.interaction, "unsaved");
      assert.equal(updateCalls, 0);
    } finally {
      gti.findUnique = origFindInv;
      uts.findUnique = origFindUts;
      uts.update = origUpdateUts;
    }

    clearTopicFeedCacheForTests();
    applyTestEnv();
    clearTopicFeedCacheForTests();

    gti.findUnique = (async () => ({ id: TOPIC_ID })) as typeof gti.findUnique;
    uts.findUnique = (async () => ({
      userId: USER_SUB,
      globalTopicId: TOPIC_ID,
      savedAt: null,
      openedAt: new Date(),
      dismissedAt: null,
      generatedAt: null,
      lastSeenAt: null,
      firstSeenAt: null,
      seenCount: 1,
      lastInteractionType: UserTopicInteractionType.OPENED,
    })) as typeof uts.findUnique;
    uts.update = (async () => {
      updateCalls += 1;
      return {} as never;
    }) as typeof uts.update;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "topic@example.com",
        username: "topicuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        `/api/v1/knowledge-engine/topics/${TOPIC_ID}/unsave`,
        { Authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(status, 200);
      const body = json as { data?: { interaction: string } };
      assert.equal(body.data?.interaction, "unsaved");
      assert.equal(updateCalls, 0);
    } finally {
      gti.findUnique = origFindInv;
      uts.findUnique = origFindUts;
      uts.update = origUpdateUts;
      clearTopicFeedCacheForTests();
    }
  });

  await t.test("unknown topic id on unsave → 404", async () => {
    applyTestEnv();

    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origFindInv = gti.findUnique.bind(gti);
    gti.findUnique = (async () => null) as typeof gti.findUnique;

    try {
      const app = createApp();
      const token = signAccessToken({
        sub: USER_SUB,
        email: "topic@example.com",
        username: "topicuser",
      });
      const { status, json } = await httpJsonPost(
        app,
        "/api/v1/knowledge-engine/topics/clnonexistenttopicidxx/unsave",
        { Authorization: `Bearer ${token}` },
        {},
      );
      assert.equal(status, 404);
      const body = json as { success?: boolean; error?: { code?: string } };
      assert.equal(body.success, false);
      assert.equal(body.error?.code, "TOPIC_NOT_FOUND");
    } finally {
      gti.findUnique = origFindInv;
    }
  });
});

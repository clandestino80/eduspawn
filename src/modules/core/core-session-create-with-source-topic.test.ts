import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../config/env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { createLearningSession } from "./core.service";

const MIN_ENV = {
  JWT_SECRET: "j".repeat(32),
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x?sslmode=require",
  NODE_ENV: "test",
} as const;

function loadEnv(): void {
  resetEnvCacheForTests();
  for (const [k, v] of Object.entries(MIN_ENV)) {
    process.env[k] = v;
  }
  resetEnvCacheForTests();
}

test("createLearningSession — Slice G sourceGlobalTopicId", async (t) => {
  await t.test("rejects unknown inventory id with 400", async () => {
    loadEnv();
    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const orig = gti.findUnique.bind(gti);
    gti.findUnique = (async () => null) as typeof gti.findUnique;
    try {
      await assert.rejects(
        () =>
          createLearningSession("user-1", {
            topic: "Physics",
            curiosityPrompt: "Why is the sky blue?",
            sourceGlobalTopicId: "clunknowninventoryid1",
          }),
        (err: unknown) =>
          err instanceof AppError &&
          err.statusCode === 400 &&
          err.code === "INVALID_SOURCE_GLOBAL_TOPIC",
      );
    } finally {
      gti.findUnique = orig;
    }
  });

  await t.test("persists sourceGlobalTopicId when inventory exists", async () => {
    loadEnv();
    const topicId = "clvalidinventoryid00001";
    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origGti = gti.findUnique.bind(gti);
    gti.findUnique = (async () => ({ id: topicId })) as typeof gti.findUnique;

    const ls = prisma.learningSession as unknown as {
      create: typeof prisma.learningSession.create;
    };
    const origCreate = ls.create.bind(ls);
    ls.create = (async (args) => {
      const d = args.data as {
        userId: string;
        topic: string;
        curiosityPrompt: string;
        sourceGlobalTopicId?: string | null;
        status: string;
      };
      return {
        id: "session-created-1",
        userId: d.userId,
        topic: d.topic,
        curiosityPrompt: d.curiosityPrompt,
        lessonTitle: null,
        lessonSummary: null,
        lessonBody: null,
        difficulty: null,
        tone: null,
        status: d.status,
        sourceGlobalTopicId: d.sourceGlobalTopicId ?? null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      };
    }) as typeof ls.create;

    try {
      const session = await createLearningSession("user-1", {
        topic: "Physics",
        curiosityPrompt: "Why is the sky blue?",
        sourceGlobalTopicId: topicId,
      });
      assert.equal(session.sourceGlobalTopicId, topicId);
    } finally {
      gti.findUnique = origGti;
      ls.create = origCreate;
    }
  });

  await t.test("omits source topic when not provided (backward compatible)", async () => {
    loadEnv();
    const ls = prisma.learningSession as unknown as {
      create: typeof prisma.learningSession.create;
    };
    const origCreate = ls.create.bind(ls);
    let captured: unknown;
    ls.create = (async (args) => {
      captured = args;
      const d = args.data as { sourceGlobalTopicId?: string | null };
      return {
        id: "session-2",
        userId: "user-1",
        topic: "Math",
        curiosityPrompt: "What is pi?",
        lessonTitle: null,
        lessonSummary: null,
        lessonBody: null,
        difficulty: null,
        tone: null,
        status: "created",
        sourceGlobalTopicId: d.sourceGlobalTopicId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as typeof ls.create;

    try {
      const session = await createLearningSession("user-1", {
        topic: "Math",
        curiosityPrompt: "What is pi?",
      });
      assert.equal(session.sourceGlobalTopicId, null);
      const data = (captured as { data?: { sourceGlobalTopicId?: string } }).data;
      assert.equal(data?.sourceGlobalTopicId, undefined);
    } finally {
      ls.create = origCreate;
    }
  });
});

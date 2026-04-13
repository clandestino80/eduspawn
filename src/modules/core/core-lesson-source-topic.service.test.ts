import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { applySourceTopicGeneratedAfterLesson } from "./core-lesson-source-topic.service";

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

test("applySourceTopicGeneratedAfterLesson", async (t) => {
  await t.test("no-ops when sourceGlobalTopicId is null", async () => {
    loadEnv();
    let upserts = 0;
    const uts = prisma.userTopicState as unknown as {
      upsert: typeof prisma.userTopicState.upsert;
    };
    const origUpsert = uts.upsert.bind(uts);
    uts.upsert = (async () => {
      upserts += 1;
      return {} as never;
    }) as typeof uts.upsert;
    try {
      await applySourceTopicGeneratedAfterLesson({
        userId: "u1",
        sourceGlobalTopicId: null,
      });
      assert.equal(upserts, 0);
    } finally {
      uts.upsert = origUpsert;
    }
  });

  await t.test("marks generated via markTopicGenerated path when id set", async () => {
    loadEnv();
    const topicId = "cllessonmarkgenerated01";
    const gti = prisma.globalTopicInventory as unknown as {
      findUnique: typeof prisma.globalTopicInventory.findUnique;
    };
    const origGti = gti.findUnique.bind(gti);
    gti.findUnique = (async () => ({ id: topicId })) as typeof gti.findUnique;

    let upserts = 0;
    const uts = prisma.userTopicState as unknown as {
      upsert: typeof prisma.userTopicState.upsert;
    };
    const origUpsert = uts.upsert.bind(uts);
    uts.upsert = (async (args) => {
      upserts += 1;
      const d = args as { create?: { lastInteractionType?: string }; update?: { lastInteractionType?: string } };
      const t = d.create?.lastInteractionType ?? d.update?.lastInteractionType;
      assert.equal(t, "GENERATED");
      return {} as never;
    }) as typeof uts.upsert;

    try {
      await applySourceTopicGeneratedAfterLesson({
        userId: "u1",
        sourceGlobalTopicId: topicId,
      });
      assert.equal(upserts, 1);
    } finally {
      gti.findUnique = origGti;
      uts.upsert = origUpsert;
    }
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/prisma";
import { listLearningSessionsForUser } from "./core-session-list.service";

type FindManyArgs = Parameters<typeof prisma.learningSession.findMany>[0];

test("listLearningSessionsForUser", async (t) => {
  await t.test("uses stable orderBy and take = limit + 1", async () => {
    const ls = prisma.learningSession as unknown as {
      findMany: typeof prisma.learningSession.findMany;
    };
    const orig = ls.findMany.bind(ls);
    let captured: FindManyArgs | undefined;
    ls.findMany = (async (args: FindManyArgs) => {
      captured = args;
      return [];
    }) as typeof ls.findMany;
    try {
      await listLearningSessionsForUser("user-111", { limit: 20 });
      assert.ok(captured);
      assert.equal(captured?.take, 21);
      assert.deepEqual(captured?.orderBy, [{ updatedAt: "desc" }, { id: "desc" }]);
      assert.deepEqual(captured?.where, { userId: "user-111" });
    } finally {
      ls.findMany = orig;
    }
  });

  await t.test("cursor adds lexicographic where on (updatedAt, id)", async () => {
    const ls = prisma.learningSession as unknown as {
      findMany: typeof prisma.learningSession.findMany;
    };
    const orig = ls.findMany.bind(ls);
    let captured: FindManyArgs | undefined;
    ls.findMany = (async (args: FindManyArgs) => {
      captured = args;
      return [];
    }) as typeof ls.findMany;
    try {
      const t0 = new Date("2026-03-03T10:00:00.000Z");
      const payload = `v1:${t0.toISOString()}:sess-middle`;
      const cursor = Buffer.from(payload, "utf8").toString("base64url");
      await listLearningSessionsForUser("user-222", { limit: 5, cursor });
      assert.ok(captured);
      assert.deepEqual(captured?.where, {
        userId: "user-222",
        OR: [
          { updatedAt: { lt: t0 } },
          { AND: [{ updatedAt: t0 }, { id: { lt: "sess-middle" } }] },
        ],
      });
    } finally {
      ls.findMany = orig;
    }
  });
});

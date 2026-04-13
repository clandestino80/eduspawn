import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import type { Express } from "express";

import { createApp } from "../../app";
import { resetEnvCacheForTests } from "../../config/env";
import { signAccessToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { setRunGlobalConceptArticleAiEnrichmentForOpsForTests } from "./services/global-concept-article-enrich-ops.service";

const JWT_SECRET = "t".repeat(32);
const DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";

const OPS_SUB = "11111111-1111-4111-8111-111111111111";
const NON_OPS_SUB = "22222222-2222-4222-8222-222222222222";

/** Must match `DETERMINISTIC_SOURCE_TYPE` in `global-concept-article-enrichment.service.ts`. */
const DETERMINISTIC_ARTICLE_SOURCE = "deterministic_seed_v1";

type FindUniqueArgs = Parameters<typeof prisma.globalConcept.findUnique>[0];

function installGlobalConceptFindUniqueStub(
  handler: (args: FindUniqueArgs) => Promise<unknown>,
): () => void {
  const client = prisma.globalConcept as unknown as {
    findUnique: typeof prisma.globalConcept.findUnique;
  };
  const original = client.findUnique.bind(client);
  client.findUnique = (async (args: FindUniqueArgs) => handler(args)) as typeof client.findUnique;
  return () => {
    client.findUnique = original;
  };
}

function applyTestEnv(overrides: Record<string, string | undefined>): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DATABASE_URL = DATABASE_URL;
  delete process.env.KNOWLEDGE_OPS_ALLOWED_USER_IDS;
  delete process.env.KNOWLEDGE_OPS_ALLOWED_EMAILS;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  resetEnvCacheForTests();
}

async function httpJson(
  app: Express,
  method: string,
  pathWithQuery: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: unknown; raw: string }> {
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
          method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let json: unknown = raw;
            try {
              json = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
            } catch {
              json = raw;
            }
            server.close(() => resolve({ status: res.statusCode ?? 0, json, raw }));
          });
        },
      );
      req.on("error", (err) => server.close(() => reject(err)));
      req.end();
    });
  });
}

test("POST /api/v1/knowledge-engine/concepts/:slug/enrich (ops contract)", async (t) => {
  await t.test("A — unauthenticated → 401", async () => {
    applyTestEnv({});
    const app = createApp();
    const { status, json } = await httpJson(
      app,
      "POST",
      "/api/v1/knowledge-engine/concepts/my-concept/enrich?dryRun=true",
      {},
    );
    assert.equal(status, 401);
    assert.ok(json && typeof json === "object");
    const body = json as { success?: boolean; error?: { code?: string } };
    assert.equal(body.success, false);
    assert.equal(body.error?.code, "AUTH_UNAUTHORIZED");
  });

  await t.test("B — authenticated, not allow-listed → 403 (controller not reached)", async () => {
    applyTestEnv({});
    const uninstall = installGlobalConceptFindUniqueStub(async () => {
      assert.fail("GlobalConcept.findUnique must not run when ops middleware denies");
    });
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: NON_OPS_SUB,
        email: "regular@example.com",
        username: "regular",
      });
      const { status, json } = await httpJson(
        app,
        "POST",
        "/api/v1/knowledge-engine/concepts/my-concept/enrich?dryRun=true",
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(status, 403);
      const body = json as { success?: boolean; error?: { code?: string } };
      assert.equal(body.success, false);
      assert.equal(body.error?.code, "KNOWLEDGE_OPS_FORBIDDEN");
    } finally {
      uninstall();
    }
  });

  await t.test("C — allow-listed dry-run → 200, outcome dry_run, no enrichment attempt", async () => {
    applyTestEnv({ KNOWLEDGE_OPS_ALLOWED_USER_IDS: OPS_SUB });
    const uninstall = installGlobalConceptFindUniqueStub(async (args) => {
      assert.equal(args.where.slug, "seedable-concept");
      return {
        id: "gc-test-1",
        slug: "seedable-concept",
        displayTitle: "Test concept",
        domain: "Science",
        subdomain: "Physics",
        microTopic: null,
        mappingKey: null,
        article: null,
      };
    });
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: OPS_SUB,
        email: "ops@example.com",
        username: "opsuser",
      });
      const { status, json } = await httpJson(
        app,
        "POST",
        "/api/v1/knowledge-engine/concepts/seedable-concept/enrich?dryRun=true",
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(status, 200);
      const body = json as {
        success?: boolean;
        data?: {
          outcome?: string;
          dryRun?: boolean;
          enrichmentAttempted?: boolean;
          slug?: string;
        };
      };
      assert.equal(body.success, true);
      assert.equal(body.data?.outcome, "dry_run");
      assert.equal(body.data?.dryRun, true);
      assert.equal(body.data?.enrichmentAttempted, false);
      assert.equal(body.data?.slug, "seedable-concept");
    } finally {
      uninstall();
    }
  });

  await t.test("D — allow-listed, unknown slug → 404 NOT_FOUND", async () => {
    applyTestEnv({ KNOWLEDGE_OPS_ALLOWED_USER_IDS: OPS_SUB });
    const uninstall = installGlobalConceptFindUniqueStub(async () => null);
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: OPS_SUB,
        email: "ops@example.com",
        username: "opsuser",
      });
      const { status, json } = await httpJson(
        app,
        "POST",
        "/api/v1/knowledge-engine/concepts/missing-slug-xyz/enrich",
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(status, 404);
      const body = json as { success?: boolean; error?: { code?: string } };
      assert.equal(body.success, false);
      assert.equal(body.error?.code, "NOT_FOUND");
    } finally {
      uninstall();
    }
  });

  await t.test("E — allow-listed live POST, already enriched article → 200 skipped_not_eligible (no AI)", async () => {
    applyTestEnv({ KNOWLEDGE_OPS_ALLOWED_USER_IDS: OPS_SUB });
    const uninstall = installGlobalConceptFindUniqueStub(async (args) => {
      assert.equal(args.where.slug, "already-enriched");
      return {
        id: "gc-test-2",
        slug: "already-enriched",
        displayTitle: "Enriched concept",
        domain: "Science",
        subdomain: "Chemistry",
        microTopic: null,
        mappingKey: null,
        article: { id: "art-1", sourceType: "ai_enriched_v1" },
      };
    });
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: OPS_SUB,
        email: "ops@example.com",
        username: "opsuser",
      });
      const { status, json } = await httpJson(
        app,
        "POST",
        "/api/v1/knowledge-engine/concepts/already-enriched/enrich",
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(status, 200);
      const body = json as {
        success?: boolean;
        data?: { outcome?: string; dryRun?: boolean; enrichmentAttempted?: boolean };
      };
      assert.equal(body.success, true);
      assert.equal(body.data?.dryRun, false);
      assert.equal(body.data?.outcome, "skipped_not_eligible");
      assert.equal(body.data?.enrichmentAttempted, false);
    } finally {
      uninstall();
    }
  });

  await t.test("F — allow-listed live POST, deterministic article → enriched (AI layer stubbed)", async () => {
    applyTestEnv({ KNOWLEDGE_OPS_ALLOWED_USER_IDS: OPS_SUB });
    const uninstallPrisma = installGlobalConceptFindUniqueStub(async (args) => {
      assert.equal(args.where.slug, "live-enriched-concept");
      return {
        id: "gc-test-enriched",
        slug: "live-enriched-concept",
        displayTitle: "Enrich me",
        domain: "Science",
        subdomain: "Biology",
        microTopic: null,
        mappingKey: null,
        article: { id: "art-det-1", sourceType: DETERMINISTIC_ARTICLE_SOURCE },
      };
    });
    const uninstallEnrich = setRunGlobalConceptArticleAiEnrichmentForOpsForTests(async (input) => {
      assert.equal(input.dryRun, false);
      assert.equal(input.globalConceptId, "gc-test-enriched");
      return "applied";
    });
    try {
      const app = createApp();
      const token = signAccessToken({
        sub: OPS_SUB,
        email: "ops@example.com",
        username: "opsuser",
      });
      const { status, json } = await httpJson(
        app,
        "POST",
        "/api/v1/knowledge-engine/concepts/live-enriched-concept/enrich",
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(status, 200);
      const body = json as {
        success?: boolean;
        data?: {
          outcome?: string;
          dryRun?: boolean;
          enrichmentAttempted?: boolean;
          hadArticleBefore?: boolean;
          seededArticleThisRequest?: boolean;
          slug?: string;
        };
      };
      assert.equal(body.success, true);
      assert.equal(body.data?.slug, "live-enriched-concept");
      assert.equal(body.data?.dryRun, false);
      assert.equal(body.data?.outcome, "enriched");
      assert.equal(body.data?.enrichmentAttempted, true);
      assert.equal(body.data?.hadArticleBefore, true);
      assert.equal(body.data?.seededArticleThisRequest, false);
    } finally {
      uninstallEnrich();
      uninstallPrisma();
    }
  });
});

/**
 * Ops backfill: AI-enrich deterministic GlobalConceptArticle rows (bounded, soft-failing).
 *
 * Requires KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED=true (and article enabled) for live runs.
 *
 * Usage (from backend/):
 *   npx tsx scripts/global-concept-article-enrichment-backfill.ts --dry-run
 *   npx tsx scripts/global-concept-article-enrichment-backfill.ts --limit=50 --batch=10
 */
import "dotenv/config";

import { loadEnv } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { runGlobalConceptArticleAiEnrichmentBackfillV1 } from "../src/modules/knowledge-engine/services/global-concept-article-enrichment-backfill.service";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  limit?: number;
  batchSize?: number;
} {
  let dryRun = false;
  let limit: number | undefined;
  let batchSize: number | undefined;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--limit=")) limit = Number(a.slice("--limit=".length));
    else if (a.startsWith("--batch=")) batchSize = Number(a.slice("--batch=".length));
  }
  return { dryRun, limit, batchSize };
}

async function main(): Promise<void> {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  if (opts.limit !== undefined && (!Number.isFinite(opts.limit) || opts.limit < 1)) {
    throw new Error("Invalid --limit (expected a positive integer).");
  }
  if (opts.batchSize !== undefined && (!Number.isFinite(opts.batchSize) || opts.batchSize < 1)) {
    throw new Error("Invalid --batch (expected a positive integer).");
  }

  const summary = await runGlobalConceptArticleAiEnrichmentBackfillV1(opts);
  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[global_concept_article_enrichment_backfill_script_fatal]", error);
  process.exitCode = 1;
});

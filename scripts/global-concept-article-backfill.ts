/**
 * Ops backfill: GlobalConceptArticle seeds for GlobalConcept rows without an article.
 *
 * Usage (from backend/):
 *   npx tsx scripts/global-concept-article-backfill.ts --dry-run
 *   npx tsx scripts/global-concept-article-backfill.ts --limit=2000 --batch=150
 */
import "dotenv/config";

import { loadEnv } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { runGlobalConceptArticleSeedBackfillV1 } from "../src/modules/knowledge-engine/services/global-concept-article-backfill.service";

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

  const summary = await runGlobalConceptArticleSeedBackfillV1(opts);
  console.info("[global_concept_article_backfill_done]", {
    dryRun: summary.dryRun,
    scanned: summary.scanned,
    seeded: summary.seeded,
    skippedInsufficientFields: summary.skippedInsufficientFields,
    skippedDisabled: summary.skippedDisabled,
    failed: summary.failed,
  });
  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[global_concept_article_backfill_script_fatal]", error);
  process.exitCode = 1;
});

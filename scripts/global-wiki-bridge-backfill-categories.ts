/**
 * Operational backfill: link existing KnowledgeCategory rows (taxonomy present, globalConceptId null)
 * to GlobalConcept using the same deterministic rules as Slice J.
 *
 * Usage (from backend/):
 *   npx tsx scripts/global-wiki-bridge-backfill-categories.ts --dry-run
 *   npx tsx scripts/global-wiki-bridge-backfill-categories.ts --limit=500 --batch=100
 *
 * Requires DATABASE_URL (and other env vars validated by loadEnv()).
 */
import "dotenv/config";

import { loadEnv } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { runKnowledgeCategoryGlobalConceptBackfillV1 } from "../src/modules/knowledge-engine/services/global-wiki-bridge-backfill.service";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  limit?: number;
  batchSize?: number;
} {
  let dryRun = false;
  let limit: number | undefined;
  let batchSize: number | undefined;
  for (const a of argv) {
    if (a === "--dry-run") {
      dryRun = true;
    } else if (a.startsWith("--limit=")) {
      limit = Number(a.slice("--limit=".length));
    } else if (a.startsWith("--batch=")) {
      batchSize = Number(a.slice("--batch=".length));
    }
  }
  return { dryRun, limit, batchSize };
}

async function main(): Promise<void> {
  loadEnv();
  const { dryRun, limit, batchSize } = parseArgs(process.argv.slice(2));

  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error("Invalid --limit (expected a positive integer).");
  }
  if (batchSize !== undefined && (!Number.isFinite(batchSize) || batchSize < 1)) {
    throw new Error("Invalid --batch (expected a positive integer).");
  }

  const summary = await runKnowledgeCategoryGlobalConceptBackfillV1({
    dryRun,
    limit,
    batchSize,
  });

  // Human-readable line for logs that aggregate JSON poorly
  console.info("[global_wiki_bridge_backfill_done]", {
    dryRun: summary.dryRun,
    scanned: summary.scanned,
    eligible: summary.eligible,
    linked: summary.linked,
    skipped: summary.skipped,
    failed: summary.failed,
  });
  console.log(JSON.stringify(summary, null, 2));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[global_wiki_bridge_backfill_script_fatal]", error);
  process.exitCode = 1;
});

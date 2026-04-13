/**
 * Ops: replenish GlobalTopicInventory when active rows or domain coverage fall below thresholds.
 *
 * Usage (from backend/):
 *   npx tsx scripts/global-topic-inventory-replenish.ts --dry-run
 *   npx tsx scripts/global-topic-inventory-replenish.ts --min-active=200 --batch=48
 */
import "dotenv/config";

import { loadEnv } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { runGlobalTopicInventoryReplenishV1 } from "../src/modules/knowledge-engine/services/topic-replenishment.service";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  minActive?: number;
  minDomains?: number;
  batch?: number;
} {
  let dryRun = false;
  let minActive: number | undefined;
  let minDomains: number | undefined;
  let batch: number | undefined;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--min-active=")) minActive = Number(a.slice("--min-active=".length));
    else if (a.startsWith("--min-domains=")) minDomains = Number(a.slice("--min-domains=".length));
    else if (a.startsWith("--batch=")) batch = Number(a.slice("--batch=".length));
  }
  return { dryRun, minActive, minDomains, batch };
}

async function main(): Promise<void> {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  for (const n of [opts.minActive, opts.minDomains, opts.batch]) {
    if (n !== undefined && (!Number.isFinite(n) || n < 1)) {
      throw new Error("Invalid numeric argument (expected positive integers).");
    }
  }

  const summary = await runGlobalTopicInventoryReplenishV1({
    minActive: opts.minActive,
    minDistinctDomains: opts.minDomains,
    batchSize: opts.batch,
    dryRun: opts.dryRun,
  });
  console.info("[global_topic_inventory_replenish_done]", summary);
  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[global_topic_inventory_replenish_script_fatal]", error);
  process.exitCode = 1;
});

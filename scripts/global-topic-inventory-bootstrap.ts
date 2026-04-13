/**
 * Ops: bootstrap GlobalTopicInventory with deterministic SYSTEM_SEED templates (batched, idempotent).
 *
 * Usage (from backend/):
 *   npx tsx scripts/global-topic-inventory-bootstrap.ts --dry-run
 *   npx tsx scripts/global-topic-inventory-bootstrap.ts --target=1000 --batch=40
 */
import "dotenv/config";

import { loadEnv } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { runGlobalTopicInventoryBootstrapV1 } from "../src/modules/knowledge-engine/services/topic-bootstrap.service";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  target?: number;
  batch?: number;
} {
  let dryRun = false;
  let target: number | undefined;
  let batch: number | undefined;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--target=")) target = Number(a.slice("--target=".length));
    else if (a.startsWith("--batch=")) batch = Number(a.slice("--batch=".length));
  }
  return { dryRun, target, batch };
}

async function main(): Promise<void> {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  if (opts.target !== undefined && (!Number.isFinite(opts.target) || opts.target < 1)) {
    throw new Error("Invalid --target (expected a positive integer).");
  }
  if (opts.batch !== undefined && (!Number.isFinite(opts.batch) || opts.batch < 1)) {
    throw new Error("Invalid --batch (expected a positive integer).");
  }

  const summary = await runGlobalTopicInventoryBootstrapV1({
    targetCount: opts.target,
    batchSize: opts.batch,
    dryRun: opts.dryRun,
  });
  console.info("[global_topic_inventory_bootstrap_done]", summary);
  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[global_topic_inventory_bootstrap_script_fatal]", error);
  process.exitCode = 1;
});

/**
 * Ops: promote one user LearningSession into GlobalTopicInventory (USER_GENERATED) if eligible.
 *
 * Usage (from backend/):
 *   npx tsx scripts/global-topic-inventory-promote-session.ts --userId=<cuid> --sessionId=<cuid> --dry-run
 */
import "dotenv/config";

import { loadEnv } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { promoteLearningSessionTopicToInventoryV1 } from "../src/modules/knowledge-engine/services/topic-promotion.service";

function parseArgs(argv: string[]): {
  userId?: string;
  sessionId?: string;
  dryRun: boolean;
} {
  let userId: string | undefined;
  let sessionId: string | undefined;
  let dryRun = false;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--userId=")) userId = a.slice("--userId=".length).trim();
    else if (a.startsWith("--sessionId=")) sessionId = a.slice("--sessionId=".length).trim();
  }
  return { userId, sessionId, dryRun };
}

async function main(): Promise<void> {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.userId || !opts.sessionId) {
    throw new Error("Required: --userId=<cuid> --sessionId=<cuid>");
  }

  const result = await promoteLearningSessionTopicToInventoryV1({
    userId: opts.userId,
    learningSessionId: opts.sessionId,
    dryRun: opts.dryRun,
  });
  console.info("[global_topic_inventory_promote_session_done]", result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[global_topic_inventory_promote_session_script_fatal]", error);
  process.exitCode = 1;
});

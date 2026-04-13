import { GlobalTopicSourceType, TopicInventoryBatchStatus, TopicInventoryBatchType } from "@prisma/client";
import {
  findExistingNormalizedKeys,
  insertGlobalTopicInventoryMany,
} from "../repositories/global-topic-inventory.repository";
import {
  createTopicInventoryBatchPending,
  updateTopicInventoryBatch,
} from "../repositories/topic-inventory-batch.repository";
import { invalidateTopicFeedCacheAll } from "./topic-feed-cache.service";
import { DOMAIN_SUBDOMAIN_PAIRS, buildTemplateInventoryRow } from "./topic-inventory-seed-templates";

const DEFAULT_TARGET = 1000;
const DEFAULT_BATCH_SIZE = 40;
const MAX_ROUNDS = 200;

export type TopicBootstrapSummaryV1 = {
  dryRun: boolean;
  targetCount: number;
  batchSize: number;
  domainPairsUsed: number;
  batchIds: string[];
  /** Rows accepted (or simulated under dry-run) across all rounds in this invocation. */
  acceptedThisRun: number;
  duplicateSkippedTotal: number;
  rounds: number;
};

/**
 * Controlled bootstrap: deterministic template topics in batches, `TopicInventoryBatch` per round,
 * `SYSTEM_SEED`, idempotent inserts via normalizedKey + skipDuplicates.
 * Not for request paths — scripts / jobs only.
 */
export async function runGlobalTopicInventoryBootstrapV1(input: {
  targetCount?: number;
  batchSize?: number;
  dryRun?: boolean;
}): Promise<TopicBootstrapSummaryV1> {
  const targetCount = Math.min(
    Math.max(1, input.targetCount ?? DEFAULT_TARGET),
    5000,
  );
  const batchSize = Math.min(Math.max(8, input.batchSize ?? DEFAULT_BATCH_SIZE), 200);
  const dryRun = input.dryRun === true;

  let acceptedThisRun = 0;
  let duplicateSkippedTotal = 0;
  const batchIds: string[] = [];
  let rounds = 0;
  let slotCursor = 0;

  while (acceptedThisRun < targetCount && rounds < MAX_ROUNDS) {
    rounds += 1;
    const remaining = targetCount - acceptedThisRun;
    const thisBatch = Math.min(batchSize, remaining);
    const slotStart = slotCursor;
    const candidates = Array.from({ length: thisBatch }, (_, i) =>
      buildTemplateInventoryRow(slotStart + i, GlobalTopicSourceType.SYSTEM_SEED),
    );
    slotCursor += thisBatch;

    const keys = candidates.map((c) => c.normalizedKey);
    const existing = await findExistingNormalizedKeys(keys);
    const novel = candidates.filter((c) => !existing.has(c.normalizedKey));
    duplicateSkippedTotal += candidates.length - novel.length;

    if (novel.length === 0) {
      break;
    }

    if (dryRun) {
      acceptedThisRun += novel.length;
      continue;
    }

    const batchId = await createTopicInventoryBatchPending({
      batchType: TopicInventoryBatchType.BOOTSTRAP,
      requestedCount: thisBatch,
      status: TopicInventoryBatchStatus.RUNNING,
      metadataJson: {
        slice: "topic_inventory_bootstrap_v1",
        round: rounds,
        slotStart,
      },
    });
    batchIds.push(batchId);

    const inserted = await insertGlobalTopicInventoryMany(novel);
    acceptedThisRun += inserted;
    await updateTopicInventoryBatch(batchId, {
      status: TopicInventoryBatchStatus.COMPLETED,
      acceptedCount: inserted,
      rejectedCount: thisBatch - inserted,
      finishedAt: new Date(),
    });
  }

  if (!dryRun && acceptedThisRun > 0) {
    try {
      invalidateTopicFeedCacheAll();
    } catch {
      /* best-effort */
    }
  }

  return {
    dryRun,
    targetCount,
    batchSize,
    domainPairsUsed: DOMAIN_SUBDOMAIN_PAIRS.length,
    batchIds,
    acceptedThisRun,
    duplicateSkippedTotal,
    rounds,
  };
}

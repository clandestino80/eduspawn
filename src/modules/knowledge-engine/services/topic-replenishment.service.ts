import { GlobalTopicSourceType, TopicInventoryBatchStatus, TopicInventoryBatchType } from "@prisma/client";
import {
  countActiveDistinctDomains,
  countActiveReusableInventory,
  findExistingNormalizedKeys,
  insertGlobalTopicInventoryMany,
} from "../repositories/global-topic-inventory.repository";
import {
  createTopicInventoryBatchPending,
  updateTopicInventoryBatch,
} from "../repositories/topic-inventory-batch.repository";
import { invalidateTopicFeedCacheAll } from "./topic-feed-cache.service";
import { buildTemplateInventoryRow } from "./topic-inventory-seed-templates";

/** Low-risk defaults; tune via script args / later config service. */
export const REPLENISH_MIN_ACTIVE_DEFAULT = 220;
export const REPLENISH_MIN_DISTINCT_DOMAINS_DEFAULT = 42;
export const REPLENISH_BATCH_SIZE_DEFAULT = 48;

export type TopicReplenishSummaryV1 = {
  skipped: boolean;
  skipReason?: string;
  dryRun: boolean;
  /** Present when a batch row was persisted (live mode). */
  batchId?: string;
  activeBefore: number;
  distinctDomainsBefore: number;
  acceptedThisRun: number;
  duplicateSkipped: number;
};

/**
 * Replenish when active reusable inventory or domain coverage falls below thresholds.
 * Not wired to feed requests — script / internal job entry only.
 */
export async function runGlobalTopicInventoryReplenishV1(input: {
  minActive?: number;
  minDistinctDomains?: number;
  batchSize?: number;
  dryRun?: boolean;
}): Promise<TopicReplenishSummaryV1> {
  const minActive = input.minActive ?? REPLENISH_MIN_ACTIVE_DEFAULT;
  const minDistinctDomains = input.minDistinctDomains ?? REPLENISH_MIN_DISTINCT_DOMAINS_DEFAULT;
  const batchSize = Math.min(Math.max(8, input.batchSize ?? REPLENISH_BATCH_SIZE_DEFAULT), 200);
  const dryRun = input.dryRun === true;

  const activeBefore = await countActiveReusableInventory();
  const distinctDomainsBefore = await countActiveDistinctDomains();

  const lowCount = activeBefore < minActive;
  const thinDomains = distinctDomainsBefore < minDistinctDomains;
  if (!lowCount && !thinDomains) {
    return {
      skipped: true,
      skipReason: "thresholds_satisfied",
      dryRun,
      activeBefore,
      distinctDomainsBefore,
      acceptedThisRun: 0,
      duplicateSkipped: 0,
    };
  }

  const slotStart = activeBefore;
  const candidates = Array.from({ length: batchSize }, (_, i) =>
    buildTemplateInventoryRow(slotStart + i, GlobalTopicSourceType.SYSTEM_REPLENISH),
  );
  const keys = candidates.map((c) => c.normalizedKey);
  const existing = await findExistingNormalizedKeys(keys);
  const novel = candidates.filter((c) => !existing.has(c.normalizedKey));
  const duplicateSkipped = candidates.length - novel.length;

  if (novel.length === 0) {
    return {
      skipped: true,
      skipReason: "no_novel_candidates",
      dryRun,
      activeBefore,
      distinctDomainsBefore,
      acceptedThisRun: 0,
      duplicateSkipped,
    };
  }

  if (dryRun) {
    return {
      skipped: false,
      dryRun: true,
      activeBefore,
      distinctDomainsBefore,
      acceptedThisRun: novel.length,
      duplicateSkipped,
    };
  }

  const batchId = await createTopicInventoryBatchPending({
    batchType: TopicInventoryBatchType.REPLENISH,
    requestedCount: batchSize,
    status: TopicInventoryBatchStatus.RUNNING,
    metadataJson: {
      slice: "topic_inventory_replenish_v1",
      activeBefore,
      distinctDomainsBefore,
      minActive,
      minDistinctDomains,
    },
  });

  const inserted = await insertGlobalTopicInventoryMany(novel);
  await updateTopicInventoryBatch(batchId, {
    status: TopicInventoryBatchStatus.COMPLETED,
    acceptedCount: inserted,
    rejectedCount: batchSize - inserted,
    finishedAt: new Date(),
  });

  if (inserted > 0) {
    try {
      invalidateTopicFeedCacheAll();
    } catch {
      /* best-effort */
    }
  }

  return {
    skipped: false,
    dryRun: false,
    batchId,
    activeBefore,
    distinctDomainsBefore,
    acceptedThisRun: inserted,
    duplicateSkipped,
  };
}

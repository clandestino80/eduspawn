import {
  GlobalTopicSourceType,
  GlobalTopicStatus,
  TopicInventoryBatchStatus,
  TopicInventoryBatchType,
} from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import {
  findExistingNormalizedKeys,
  insertGlobalTopicInventoryMany,
} from "../repositories/global-topic-inventory.repository";
import {
  createTopicInventoryBatchPending,
  updateTopicInventoryBatch,
} from "../repositories/topic-inventory-batch.repository";
import { invalidateTopicFeedCacheAll } from "./topic-feed-cache.service";
import { markTopicGenerated } from "./user-topic-state.service";
import { buildGlobalTopicNormalizedKey } from "./topic-inventory-normalization";

const MIN_TOPIC_LEN = 3;
const MIN_CURIOSITY_LEN = 12;
const MIN_SUBSTANTIVE_LEN = 40;

export type PromoteLearningSessionTopicResultV1 =
  | { ok: true; dryRun: true; normalizedKey: string }
  | { ok: true; dryRun: false; globalTopicId: string; normalizedKey: string; batchId: string }
  | {
      ok: false;
      code: "SESSION_NOT_FOUND" | "NOT_ELIGIBLE" | "DUPLICATE";
      message: string;
    };

type SessionProjection = {
  id: string;
  userId: string;
  topic: string;
  curiosityPrompt: string;
  lessonTitle: string | null;
  lessonSummary: string | null;
  lessonBody: string | null;
};

export function evaluatePromotionEligibility(session: SessionProjection): {
  ok: boolean;
  reason?: string;
} {
  const topic = session.topic.trim();
  const curiosity = session.curiosityPrompt.trim();
  if (topic.length < MIN_TOPIC_LEN) {
    return { ok: false, reason: "topic_too_short" };
  }
  if (curiosity.length < MIN_CURIOSITY_LEN) {
    return { ok: false, reason: "curiosity_too_short" };
  }
  const lt = (session.lessonTitle ?? "").trim().length;
  const ls = (session.lessonSummary ?? "").trim().length;
  const lb = (session.lessonBody ?? "").trim().length;
  if (Math.max(lt, ls, lb) < MIN_SUBSTANTIVE_LEN) {
    return { ok: false, reason: "insufficient_lesson_material" };
  }
  return { ok: true };
}

/**
 * Deterministic promotion of a user learning session into `GlobalTopicInventory` (USER_GENERATED).
 * Idempotent on `normalizedKey`. Not exposed on feed GET.
 */
export async function promoteLearningSessionTopicToInventoryV1(params: {
  userId: string;
  learningSessionId: string;
  dryRun?: boolean;
}): Promise<PromoteLearningSessionTopicResultV1> {
  const dryRun = params.dryRun === true;

  const session = await prisma.learningSession.findFirst({
    where: { id: params.learningSessionId, userId: params.userId },
    select: {
      id: true,
      userId: true,
      topic: true,
      curiosityPrompt: true,
      lessonTitle: true,
      lessonSummary: true,
      lessonBody: true,
    },
  });

  if (!session) {
    return {
      ok: false,
      code: "SESSION_NOT_FOUND",
      message: "Learning session not found for this user.",
    };
  }

  const elig = evaluatePromotionEligibility(session);
  if (!elig.ok) {
    return {
      ok: false,
      code: "NOT_ELIGIBLE",
      message: elig.reason ?? "not_eligible",
    };
  }

  const category = await prisma.knowledgeCategory.findFirst({
    where: { userId: params.userId, sourceSessionId: session.id },
    select: { domain: true, subdomain: true, label: true },
    orderBy: { updatedAt: "desc" },
  });

  const domain = (category?.domain ?? "General").trim() || "General";
  const subdomain = (category?.subdomain ?? "Exploration").trim() || "Exploration";
  const title = (session.lessonTitle?.trim() || session.topic.trim()).slice(0, 200);
  const curiosityHook = session.curiosityPrompt.trim().slice(0, 2000);
  const shortSummary =
    (session.lessonSummary?.trim() || session.lessonBody?.trim() || session.lessonTitle?.trim() || "").slice(
      0,
      2000,
    ) || null;

  const normalizedKey = buildGlobalTopicNormalizedKey({
    domain,
    subdomain,
    title,
    curiosityHook,
  });

  const dup = await findExistingNormalizedKeys([normalizedKey]);
  if (dup.has(normalizedKey)) {
    return {
      ok: false,
      code: "DUPLICATE",
      message: "An inventory row with this normalized key already exists.",
    };
  }

  const row = {
    normalizedKey,
    title,
    curiosityHook,
    shortSummary,
    domain,
    subdomain,
    microTopic: null,
    categoryLabel: category?.label?.trim() ?? null,
    sourceType: GlobalTopicSourceType.USER_GENERATED,
    status: GlobalTopicStatus.ACTIVE,
    qualityScore: 48,
    reuseEligible: true,
    freshnessBucket: "user_promotion_v1",
    sourceUserId: params.userId,
    sourceLearningSessionId: session.id,
    globalConceptId: null,
  };

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      normalizedKey,
    };
  }

  const batchId = await createTopicInventoryBatchPending({
    batchType: TopicInventoryBatchType.USER_PROMOTION,
    requestedCount: 1,
    status: TopicInventoryBatchStatus.RUNNING,
    domainHint: domain,
    subdomainHint: subdomain,
    metadataJson: {
      slice: "topic_inventory_promotion_v1",
      learningSessionId: session.id,
      userId: params.userId,
    },
  });

  const inserted = await insertGlobalTopicInventoryMany([row]);
  if (inserted < 1) {
    await updateTopicInventoryBatch(batchId, {
      status: TopicInventoryBatchStatus.FAILED,
      acceptedCount: 0,
      rejectedCount: 1,
      finishedAt: new Date(),
    });
    return {
      ok: false,
      code: "DUPLICATE",
      message: "Insert skipped (duplicate normalized key race).",
    };
  }

  const created = await prisma.globalTopicInventory.findUnique({
    where: { normalizedKey },
    select: { id: true },
  });

  await updateTopicInventoryBatch(batchId, {
    status: TopicInventoryBatchStatus.COMPLETED,
    acceptedCount: 1,
    rejectedCount: 0,
    finishedAt: new Date(),
  });

  if (!created) {
    return {
      ok: false,
      code: "NOT_ELIGIBLE",
      message: "Row missing after insert.",
    };
  }

  try {
    invalidateTopicFeedCacheAll();
  } catch {
    /* non-fatal — feed cache is best-effort */
  }

  try {
    await markTopicGenerated({ userId: params.userId, globalTopicId: created.id });
  } catch (error) {
    console.error("[topic_state_mark_generated_failed]", {
      userId: params.userId,
      globalTopicId: created.id,
      error,
    });
  }

  return {
    ok: true,
    dryRun: false,
    globalTopicId: created.id,
    normalizedKey,
    batchId,
  };
}

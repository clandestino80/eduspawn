import { AppError } from "../../../lib/errors";
import { findGlobalTopicInventoryIdExists } from "../repositories/global-topic-inventory.repository";
import {
  clearUserTopicSaved,
  upsertUserTopicDismissed,
  upsertUserTopicGenerated,
  upsertUserTopicOpened,
  upsertUserTopicSaved,
  upsertUserTopicSeen,
} from "../repositories/user-topic-state.repository";
import { invalidateTopicFeedCacheForUser } from "./topic-feed-cache.service";

export type TopicInteractionResponse = {
  topicId: string;
  interaction: "opened" | "dismissed" | "saved" | "seen" | "generated" | "unsaved";
};

async function ensureTopicExistsOrThrow(globalTopicId: string): Promise<void> {
  const id = await findGlobalTopicInventoryIdExists(globalTopicId);
  if (!id) {
    throw new AppError(404, "Topic not found", { code: "TOPIC_NOT_FOUND" });
  }
}

function invalidateUserFeedCache(userId: string): void {
  try {
    invalidateTopicFeedCacheForUser(userId);
  } catch {
    /* best-effort */
  }
}

export async function markTopicOpened(params: {
  userId: string;
  globalTopicId: string;
}): Promise<TopicInteractionResponse> {
  await ensureTopicExistsOrThrow(params.globalTopicId);
  await upsertUserTopicOpened(params);
  invalidateUserFeedCache(params.userId);
  return { topicId: params.globalTopicId, interaction: "opened" };
}

export async function markTopicDismissed(params: {
  userId: string;
  globalTopicId: string;
}): Promise<TopicInteractionResponse> {
  await ensureTopicExistsOrThrow(params.globalTopicId);
  await upsertUserTopicDismissed(params);
  invalidateUserFeedCache(params.userId);
  return { topicId: params.globalTopicId, interaction: "dismissed" };
}

export async function markTopicSaved(params: {
  userId: string;
  globalTopicId: string;
}): Promise<TopicInteractionResponse> {
  await ensureTopicExistsOrThrow(params.globalTopicId);
  await upsertUserTopicSaved(params);
  invalidateUserFeedCache(params.userId);
  return { topicId: params.globalTopicId, interaction: "saved" };
}

export async function markTopicUnsaved(params: {
  userId: string;
  globalTopicId: string;
}): Promise<TopicInteractionResponse> {
  await ensureTopicExistsOrThrow(params.globalTopicId);
  await clearUserTopicSaved(params);
  invalidateUserFeedCache(params.userId);
  return { topicId: params.globalTopicId, interaction: "unsaved" };
}

export async function markTopicSeen(params: {
  userId: string;
  globalTopicId: string;
}): Promise<TopicInteractionResponse> {
  await ensureTopicExistsOrThrow(params.globalTopicId);
  await upsertUserTopicSeen(params);
  invalidateUserFeedCache(params.userId);
  return { topicId: params.globalTopicId, interaction: "seen" };
}

/**
 * Marks inventory topic as generated-from for this user (feed exclusion).
 * Called after successful user promotion into inventory; may be reused when session↔topic links exist (Slice G).
 */
export async function markTopicGenerated(params: {
  userId: string;
  globalTopicId: string;
}): Promise<TopicInteractionResponse> {
  await ensureTopicExistsOrThrow(params.globalTopicId);
  await upsertUserTopicGenerated(params);
  invalidateUserFeedCache(params.userId);
  return { topicId: params.globalTopicId, interaction: "generated" };
}

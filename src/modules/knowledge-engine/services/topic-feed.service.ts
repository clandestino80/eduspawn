import type { GlobalTopicInventoryFeedRow } from "../repositories/global-topic-inventory.repository";
import { findActiveReusableTopicsForFeed } from "../repositories/global-topic-inventory.repository";
import type { UserTopicStateFeedProjection } from "../repositories/user-topic-state.repository";
import {
  findUserSavedTopicsWithInventory,
  findUserTopicStatesForTopicIds,
} from "../repositories/user-topic-state.repository";

const CANDIDATE_MULTIPLIER = 6;
const MAX_CANDIDATES = 240;
/** Optional deprioritization: hide topics seen in the last 24h (UTC-relative to server clock). */
const RECENTLY_SEEN_MS = 24 * 60 * 60 * 1000;

export type TopicFeedGlobalConceptDto = {
  slug: string;
  displayTitle: string;
  hasArticle: boolean;
  articleSummary: string | null;
  articleHook: string | null;
};

export type TopicFeedItemDto = {
  id: string;
  title: string;
  curiosityHook: string | null;
  shortSummary: string | null;
  domain: string | null;
  subdomain: string | null;
  microTopic: string | null;
  categoryLabel: string | null;
  globalConcept: TopicFeedGlobalConceptDto | null;
  /** True when the user has any prior exposure record for this topic (not necessarily filtered out). */
  alreadySeen: boolean;
};

export type TopicFeedResponseDto = {
  topics: TopicFeedItemDto[];
};

export type SavedTopicItemDto = TopicFeedItemDto & {
  savedAt: string;
};

export type SavedTopicsResponseDto = {
  topics: SavedTopicItemDto[];
};

function clipText(text: string | null | undefined, max: number): string | null {
  if (!text?.trim()) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, "").trim()}…`;
}

function mapGlobalConcept(row: GlobalTopicInventoryFeedRow): TopicFeedGlobalConceptDto | null {
  const gc = row.globalConcept;
  if (!gc) return null;
  const art = gc.article;
  const hasArticle = Boolean(art);
  return {
    slug: gc.slug,
    displayTitle: gc.displayTitle,
    hasArticle,
    articleSummary: hasArticle ? clipText(art?.summary ?? null, 280) : null,
    articleHook: hasArticle ? clipText(art?.hook ?? null, 200) : null,
  };
}

function isExcludedFromFreshSuggestions(
  state: UserTopicStateFeedProjection | undefined,
  nowMs: number,
): boolean {
  if (!state) return false;
  if (state.generatedAt != null) return true;
  if (state.lastInteractionType === "GENERATED") return true;
  if (state.dismissedAt != null) return true;
  if (state.lastSeenAt != null && nowMs - state.lastSeenAt.getTime() < RECENTLY_SEEN_MS) return true;
  return false;
}

function alreadySeenFlag(state: UserTopicStateFeedProjection | undefined): boolean {
  if (!state) return false;
  if (state.firstSeenAt != null || state.lastSeenAt != null) return true;
  if (state.openedAt != null || state.savedAt != null) return true;
  return (state.seenCount ?? 0) > 0;
}

function toFeedItem(
  row: GlobalTopicInventoryFeedRow,
  state: UserTopicStateFeedProjection | undefined,
): TopicFeedItemDto {
  return {
    id: row.id,
    title: row.title,
    curiosityHook: row.curiosityHook,
    shortSummary: row.shortSummary,
    domain: row.domain,
    subdomain: row.subdomain,
    microTopic: row.microTopic,
    categoryLabel: row.categoryLabel,
    globalConcept: mapGlobalConcept(row),
    alreadySeen: alreadySeenFlag(state),
  };
}

/** Aligns with `topicFeedQuerySchema` max and feed selection heuristics. */
export function clampTopicFeedApiLimit(limit: number): number {
  return Math.min(Math.max(1, limit), 50);
}

/**
 * Read-only global topic feed: inventory-backed, user-aware exclusions, deterministic order.
 * No LLM, no writes, no metering.
 *
 * Slice F: SEEN / OPENED are explicit POST `/topics/:id/seen|open` actions — not applied on GET.
 */
export async function listTopicFeedForUserApi(input: {
  userId: string;
  limit: number;
  domain?: string;
  subdomain?: string;
}): Promise<TopicFeedResponseDto> {
  const limit = clampTopicFeedApiLimit(input.limit);
  const take = Math.min(MAX_CANDIDATES, Math.max(limit * CANDIDATE_MULTIPLIER, limit + 16));

  const rows = await findActiveReusableTopicsForFeed({
    take,
    domain: input.domain,
    subdomain: input.subdomain,
  });
  const ids = rows.map((r) => r.id);
  const states = await findUserTopicStatesForTopicIds({ userId: input.userId, topicIds: ids });
  const stateByTopic = new Map(states.map((s) => [s.globalTopicId, s]));
  const nowMs = Date.now();

  const eligible: GlobalTopicInventoryFeedRow[] = [];
  for (const row of rows) {
    if (eligible.length >= limit) break;
    const st = stateByTopic.get(row.id);
    if (isExcludedFromFreshSuggestions(st, nowMs)) continue;
    eligible.push(row);
  }

  return {
    topics: eligible.map((row) => toFeedItem(row, stateByTopic.get(row.id))),
  };
}

/**
 * Read-only list of topics the user saved via POST `/topics/:id/save`, newest first.
 */
export async function listSavedTopicsForUserApi(input: {
  userId: string;
  limit: number;
}): Promise<SavedTopicsResponseDto> {
  const limit = clampTopicFeedApiLimit(input.limit);
  const savedRows = await findUserSavedTopicsWithInventory({
    userId: input.userId,
    take: limit,
  });
  const ids = savedRows.map((r) => r.inventory.id);
  const states = await findUserTopicStatesForTopicIds({ userId: input.userId, topicIds: ids });
  const stateByTopic = new Map(states.map((s) => [s.globalTopicId, s]));
  const topics: SavedTopicItemDto[] = savedRows.map(({ savedAt, inventory }) => ({
    ...toFeedItem(inventory, stateByTopic.get(inventory.id)),
    savedAt: savedAt.toISOString(),
  }));
  return { topics };
}

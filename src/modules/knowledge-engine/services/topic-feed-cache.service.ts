import { getEnv } from "../../../config/env";
import { clampTopicFeedApiLimit, type TopicFeedResponseDto } from "./topic-feed.service";

/**
 * Bump when feed selection / DTO shape or exclusion rules change materially so stale entries are not reused.
 * Coarse invalidation also runs on inventory writes and per-user lesson generation (see invalidation helpers).
 */
export const TOPIC_FEED_CACHE_SEMANTIC_VERSION = "tf1";

type CacheEntry = {
  expiresAtMs: number;
  payload: TopicFeedResponseDto;
};

const store = new Map<string, CacheEntry>();
const MAX_ENTRIES = 5000;

function cloneFeedPayload(payload: TopicFeedResponseDto): TopicFeedResponseDto {
  return structuredClone(payload);
}

function normalizeKeyPart(value: string | undefined): string {
  const t = (value ?? "").trim();
  if (t.length === 0) return "_";
  return t.toLowerCase();
}

/**
 * Stable cache key: user, clamped limit, filters, semantic version.
 */
export function buildTopicFeedCacheKey(input: {
  userId: string;
  limit: number;
  domain?: string;
  subdomain?: string;
}): string {
  const limit = clampTopicFeedApiLimit(input.limit);
  const d = normalizeKeyPart(input.domain);
  const s = normalizeKeyPart(input.subdomain);
  return `${TOPIC_FEED_CACHE_SEMANTIC_VERSION}|u=${input.userId}|l=${limit}|d=${d}|s=${s}`;
}

function effectiveTtlSeconds(): number {
  const raw = getEnv().TOPIC_FEED_CACHE_TTL_SECONDS;
  return Math.min(600, Math.max(5, raw));
}

function pruneIfOversized(): void {
  if (store.size <= MAX_ENTRIES) return;
  const drop = Math.ceil(MAX_ENTRIES * 0.1);
  let n = 0;
  for (const k of store.keys()) {
    store.delete(k);
    n += 1;
    if (n >= drop) break;
  }
}

/** Drop all cached feed rows for one user (after lesson generation, dismiss hooks, etc.). */
export function invalidateTopicFeedCacheForUser(userId: string): void {
  const prefix = `${TOPIC_FEED_CACHE_SEMANTIC_VERSION}|u=${userId}|`;
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) {
      store.delete(k);
    }
  }
}

/**
 * Coarse invalidation when global inventory changes (replenish, bootstrap, user promotion).
 * Same-process API servers only; CLI scripts use a separate process and do not clear this map.
 */
export function invalidateTopicFeedCacheAll(): void {
  store.clear();
}

/** Test helper — clears in-memory cache between cases. */
export function clearTopicFeedCacheForTests(): void {
  store.clear();
}

/**
 * Optional read-through cache for `listTopicFeedForUserApi`.
 * - No metering / wallet / usage writes on hit or miss.
 * - Returns a deep copy so callers cannot mutate stored payloads.
 */
export async function listTopicFeedForUserWithCache(
  input: { userId: string; limit: number; domain?: string; subdomain?: string },
  loader: () => Promise<TopicFeedResponseDto>,
): Promise<TopicFeedResponseDto> {
  if (!getEnv().TOPIC_FEED_CACHE_ENABLED) {
    return loader();
  }

  const key = buildTopicFeedCacheKey(input);
  const now = Date.now();
  const hit = store.get(key);
  if (hit !== undefined && hit.expiresAtMs > now) {
    return cloneFeedPayload(hit.payload);
  }
  if (hit !== undefined) {
    store.delete(key);
  }

  const fresh = await loader();
  store.set(key, {
    expiresAtMs: now + effectiveTtlSeconds() * 1000,
    payload: cloneFeedPayload(fresh),
  });
  pruneIfOversized();
  return cloneFeedPayload(fresh);
}

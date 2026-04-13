import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../../config/env";
import {
  buildTopicFeedCacheKey,
  clearTopicFeedCacheForTests,
  invalidateTopicFeedCacheAll,
  invalidateTopicFeedCacheForUser,
  listTopicFeedForUserWithCache,
} from "./topic-feed-cache.service";
import type { TopicFeedResponseDto } from "./topic-feed.service";

const MIN_ENV = {
  JWT_SECRET: "j".repeat(32),
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x?sslmode=require",
  NODE_ENV: "test",
} as const;

function loadEnv(overrides: Record<string, string>): void {
  resetEnvCacheForTests();
  for (const [k, v] of Object.entries(MIN_ENV)) {
    process.env[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  resetEnvCacheForTests();
}

const samplePayload = (): TopicFeedResponseDto => ({
  topics: [{ id: "t1", title: "A", curiosityHook: null, shortSummary: null, domain: null, subdomain: null, microTopic: null, categoryLabel: null, globalConcept: null, alreadySeen: false }],
});

test("topic-feed-cache.service", async (t) => {
  await t.test("buildTopicFeedCacheKey normalizes domain/subdomain and clamps limit", () => {
    const a = buildTopicFeedCacheKey({
      userId: "u1",
      limit: 99,
      domain: "  Math ",
      subdomain: undefined,
    });
    const b = buildTopicFeedCacheKey({
      userId: "u1",
      limit: 50,
      domain: "math",
      subdomain: "",
    });
    assert.equal(a, b);
  });

  await t.test("when cache disabled, loader runs every time", async () => {
    loadEnv({ TOPIC_FEED_CACHE_ENABLED: "false" });
    clearTopicFeedCacheForTests();
    let n = 0;
    const loader = async (): Promise<TopicFeedResponseDto> => {
      n += 1;
      return samplePayload();
    };
    await listTopicFeedForUserWithCache({ userId: "u1", limit: 10 }, loader);
    await listTopicFeedForUserWithCache({ userId: "u1", limit: 10 }, loader);
    assert.equal(n, 2);
  });

  await t.test("when cache enabled, same key hits cache (loader once)", async () => {
    loadEnv({ TOPIC_FEED_CACHE_ENABLED: "true", TOPIC_FEED_CACHE_TTL_SECONDS: "120" });
    clearTopicFeedCacheForTests();
    let n = 0;
    const loader = async (): Promise<TopicFeedResponseDto> => {
      n += 1;
      return samplePayload();
    };
    const a = await listTopicFeedForUserWithCache({ userId: "u2", limit: 10 }, loader);
    const b = await listTopicFeedForUserWithCache({ userId: "u2", limit: 10 }, loader);
    assert.equal(n, 1);
    assert.deepEqual(a, b);
  });

  await t.test("invalidateTopicFeedCacheForUser forces reload", async () => {
    loadEnv({ TOPIC_FEED_CACHE_ENABLED: "true", TOPIC_FEED_CACHE_TTL_SECONDS: "120" });
    clearTopicFeedCacheForTests();
    let n = 0;
    const loader = async (): Promise<TopicFeedResponseDto> => {
      n += 1;
      return samplePayload();
    };
    await listTopicFeedForUserWithCache({ userId: "u3", limit: 10 }, loader);
    invalidateTopicFeedCacheForUser("u3");
    await listTopicFeedForUserWithCache({ userId: "u3", limit: 10 }, loader);
    assert.equal(n, 2);
  });

  await t.test("invalidateTopicFeedCacheAll clears all keys", async () => {
    loadEnv({ TOPIC_FEED_CACHE_ENABLED: "true", TOPIC_FEED_CACHE_TTL_SECONDS: "120" });
    clearTopicFeedCacheForTests();
    let n = 0;
    const loader = async (): Promise<TopicFeedResponseDto> => {
      n += 1;
      return samplePayload();
    };
    await listTopicFeedForUserWithCache({ userId: "u4", limit: 10 }, loader);
    await listTopicFeedForUserWithCache({ userId: "u5", limit: 10 }, loader);
    assert.equal(n, 2);
    await listTopicFeedForUserWithCache({ userId: "u4", limit: 10 }, loader);
    await listTopicFeedForUserWithCache({ userId: "u5", limit: 10 }, loader);
    assert.equal(n, 2);
    invalidateTopicFeedCacheAll();
    await listTopicFeedForUserWithCache({ userId: "u4", limit: 10 }, loader);
    assert.equal(n, 3);
  });

  clearTopicFeedCacheForTests();
});

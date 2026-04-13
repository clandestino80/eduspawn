import assert from "node:assert/strict";
import test from "node:test";

import { buildCreatorLookupKey, buildCreatorMemoryKeyFacets } from "./creator-memory-key";

test("creator-memory-key", async (t) => {
  await t.test("same facets → same lookup key", () => {
    const a = buildCreatorMemoryKeyFacets({
      topic: "  Quantum basics ",
      curiosityPrompt: "Why superposition?",
      durationBand: "short_lte_60",
      targetPlatform: "tiktok",
      presetKey: "edu_explainer",
      language: "en",
      tone: "curious",
      goal: "short_video",
      packKind: "SHORT_FORM",
    });
    const b = buildCreatorMemoryKeyFacets({
      topic: "quantum basics",
      curiosityPrompt: "why superposition?",
      durationBand: "short_lte_60",
      targetPlatform: "tiktok",
      presetKey: "edu_explainer",
      language: "en",
      tone: "curious",
      goal: "short_video",
      packKind: "SHORT_FORM",
    });
    assert.equal(buildCreatorLookupKey(a), buildCreatorLookupKey(b));
  });

  await t.test("different tone → different key", () => {
    const base = {
      topic: "x",
      curiosityPrompt: "y",
      durationBand: "short_lte_60",
      targetPlatform: "generic",
      language: "en",
      goal: "learning_to_content",
      packKind: "SHORT_FORM" as const,
    };
    const k1 = buildCreatorLookupKey(buildCreatorMemoryKeyFacets({ ...base, tone: "a" }));
    const k2 = buildCreatorLookupKey(buildCreatorMemoryKeyFacets({ ...base, tone: "b" }));
    assert.notEqual(k1, k2);
  });
});

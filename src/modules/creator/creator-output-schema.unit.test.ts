import assert from "node:assert/strict";
import test from "node:test";

import { longCreatorPackSchema } from "./schemas/creator-output-long.schema";
import { shortCreatorPackSchema } from "./schemas/creator-output-short.schema";
import { creatorGenerationRequestSchema } from "./schemas/creator-request.schema";

test("creator schemas", async (t) => {
  await t.test("creatorGenerationRequestSchema accepts valid body", () => {
    const r = creatorGenerationRequestSchema.safeParse({
      topic: "Photosynthesis",
      curiosityPrompt: "Why do leaves change color?",
      goal: "short_video",
      durationSec: 45,
      targetPlatform: "reels",
      tone: "friendly",
      audience: "high school students",
      language: "en",
    });
    assert.equal(r.success, true);
  });

  await t.test("shortCreatorPackSchema rejects empty title", () => {
    const r = shortCreatorPackSchema.safeParse({
      title: "",
      hook: "h",
      shortIntro: "i",
      shortScript: "s",
      titleSequenceText: "t",
      voiceoverText: "v",
      visualCue: "c",
    });
    assert.equal(r.success, false);
  });

  await t.test("longCreatorPackSchema requires sceneNarration length match", () => {
    const r = longCreatorPackSchema.safeParse({
      projectTitle: "P",
      positioningLine: "pos",
      titleSequencePack: "ts",
      hookVariants: ["a", "b"],
      masterSynopsis: "syn",
      sceneOutline: [{ sceneNumber: 1, beat: "b" }],
      sceneNarration: [],
      voiceoverScript: "v",
      visualPromptPack: "vp",
      musicMood: "m",
      endingCTA: "e",
      productionNotes: "n",
    });
    assert.equal(r.success, false);
  });
});

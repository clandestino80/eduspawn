import assert from "node:assert/strict";
import test from "node:test";

import { isEligibleForDefaultGlobalPromotion } from "./creator-promotion-policy";

test("creator-promotion-policy", async (t) => {
  await t.test("rejects email-like content", () => {
    assert.equal(
      isEligibleForDefaultGlobalPromotion({
        originalPack: {
          title: "Reach out video",
          hook: "contact me@test.com for more",
          shortIntro: "i",
          shortScript: "s",
          titleSequenceText: "t",
          voiceoverText: "v",
          visualCue: "c",
        },
      }),
      false,
    );
  });

  await t.test("accepts normal short pack", () => {
    assert.equal(
      isEligibleForDefaultGlobalPromotion({
        originalPack: {
          title: "Space elevators",
          hook: "What if cables could reach orbit?",
          shortIntro: "A quick explainer.",
          shortScript: "Script",
          titleSequenceText: "Title",
          voiceoverText: "Voice",
          visualCue: "B-roll of Earth",
        },
      }),
      true,
    );
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePromotionEligibility } from "./services/topic-promotion.service";

test("evaluatePromotionEligibility", async (t) => {
  await t.test("rejects short curiosity", () => {
    const r = evaluatePromotionEligibility({
      id: "s1",
      userId: "u1",
      topic: "Photosynthesis",
      curiosityPrompt: "short",
      lessonTitle: null,
      lessonSummary: "x".repeat(50),
      lessonBody: null,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "curiosity_too_short");
  });

  await t.test("rejects when no lesson field reaches substantive length", () => {
    const r = evaluatePromotionEligibility({
      id: "s1",
      userId: "u1",
      topic: "Photosynthesis",
      curiosityPrompt: "A longer curiosity prompt here.",
      lessonTitle: "tiny",
      lessonSummary: null,
      lessonBody: null,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "insufficient_lesson_material");
  });

  await t.test("accepts typical eligible session", () => {
    const r = evaluatePromotionEligibility({
      id: "s1",
      userId: "u1",
      topic: "Photosynthesis",
      curiosityPrompt: "How do plants turn light into chemical energy?",
      lessonTitle: "Energy in living systems",
      lessonSummary: "y".repeat(45),
      lessonBody: null,
    });
    assert.equal(r.ok, true);
  });
});

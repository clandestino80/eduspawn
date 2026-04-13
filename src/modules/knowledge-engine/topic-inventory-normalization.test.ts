import assert from "node:assert/strict";
import test from "node:test";

import { buildGlobalTopicNormalizedKey } from "./services/topic-inventory-normalization";

test("buildGlobalTopicNormalizedKey", async (t) => {
  await t.test("stable for identical inputs", () => {
    const a = buildGlobalTopicNormalizedKey({
      domain: "STEM",
      subdomain: "Physics",
      title: "Waves and interference",
      curiosityHook: "Why do patterns repeat?",
    });
    const b = buildGlobalTopicNormalizedKey({
      domain: "STEM",
      subdomain: "Physics",
      title: "Waves and interference",
      curiosityHook: "Why do patterns repeat?",
    });
    assert.equal(a, b);
  });

  await t.test("case and whitespace normalization", () => {
    const a = buildGlobalTopicNormalizedKey({
      domain: "Stem",
      subdomain: " PHYSICS ",
      title: "  Waves   ",
      curiosityHook: " WHY? ",
    });
    const b = buildGlobalTopicNormalizedKey({
      domain: "stem",
      subdomain: "physics",
      title: "waves",
      curiosityHook: "why?",
    });
    assert.equal(a, b);
  });

  await t.test("uses hashed prefix when raw key is too long", () => {
    const longTitle = "x".repeat(400);
    const key = buildGlobalTopicNormalizedKey({
      domain: "D",
      subdomain: "S",
      title: longTitle,
      curiosityHook: "y".repeat(200),
    });
    assert.ok(key.startsWith("h:"));
    assert.equal(key.length, 2 + 64);
  });
});

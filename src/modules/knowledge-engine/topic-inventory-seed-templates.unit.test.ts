import assert from "node:assert/strict";
import test from "node:test";

import { GlobalTopicSourceType } from "@prisma/client";

import { DOMAIN_SUBDOMAIN_PAIRS, buildTemplateInventoryRow } from "./services/topic-inventory-seed-templates";

test("topic inventory seed templates", async (t) => {
  await t.test("domain ladder meets variety intent (≥50 pairs)", () => {
    assert.ok(DOMAIN_SUBDOMAIN_PAIRS.length >= 50);
  });

  await t.test("consecutive slots produce unique normalized keys", () => {
    const keys = new Set<string>();
    for (let slot = 0; slot < 120; slot += 1) {
      const row = buildTemplateInventoryRow(slot, GlobalTopicSourceType.SYSTEM_SEED);
      keys.add(row.normalizedKey);
    }
    assert.equal(keys.size, 120);
  });
});

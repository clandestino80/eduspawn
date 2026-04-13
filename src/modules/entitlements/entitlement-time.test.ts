import assert from "node:assert/strict";
import test from "node:test";

import { currentUtcPeriodMonth, utcUsageDateForNow } from "./entitlement-time";

test("entitlement-time", async (t) => {
  await t.test("utcUsageDateForNow is midnight UTC", () => {
    const d = new Date("2026-06-15T18:30:00.000Z");
    const u = utcUsageDateForNow(d);
    assert.equal(u.toISOString(), "2026-06-15T00:00:00.000Z");
  });

  await t.test("currentUtcPeriodMonth is YYYY-MM", () => {
    const d = new Date("2026-03-08T12:00:00.000Z");
    assert.equal(currentUtcPeriodMonth(d), "2026-03");
  });
});

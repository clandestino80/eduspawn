import assert from "node:assert/strict";
import test from "node:test";

import { SlidingWindowRateLimiter } from "./in-memory-rate-limiter";

test("SlidingWindowRateLimiter allows up to max within window", () => {
  const lim = new SlidingWindowRateLimiter();
  const w = 10_000;
  const max = 3;
  assert.equal(lim.tryConsume("a", w, max).ok, true);
  assert.equal(lim.tryConsume("a", w, max).ok, true);
  assert.equal(lim.tryConsume("a", w, max).ok, true);
  const r = lim.tryConsume("a", w, max);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.retryAfterSec >= 1);
  }
});

test("SlidingWindowRateLimiter uses separate keys", () => {
  const lim = new SlidingWindowRateLimiter();
  const w = 60_000;
  const max = 1;
  assert.equal(lim.tryConsume("u1", w, max).ok, true);
  assert.equal(lim.tryConsume("u2", w, max).ok, true);
});

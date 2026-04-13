import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRenderSubmissionAbuse } from "./abuse-controls.service";

test("evaluateRenderSubmissionAbuse allows within caps", () => {
  const r = evaluateRenderSubmissionAbuse({
    activeJobsUser: 2,
    activeJobsForPack: 0,
    maxActiveUser: 5,
    maxActivePerPack: 1,
  });
  assert.equal(r.ok, true);
});

test("evaluateRenderSubmissionAbuse blocks user-wide cap", () => {
  const r = evaluateRenderSubmissionAbuse({
    activeJobsUser: 5,
    activeJobsForPack: 0,
    maxActiveUser: 5,
    maxActivePerPack: 1,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "RENDER_TOO_MANY_ACTIVE_JOBS");
    assert.equal(r.httpStatus, 429);
  }
});

test("evaluateRenderSubmissionAbuse blocks per-pack cap", () => {
  const r = evaluateRenderSubmissionAbuse({
    activeJobsUser: 1,
    activeJobsForPack: 1,
    maxActiveUser: 10,
    maxActivePerPack: 1,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "RENDER_ACTIVE_JOB_FOR_PACK");
    assert.equal(r.httpStatus, 409);
  }
});

test("evaluateRenderSubmissionAbuse disables checks when max is 0", () => {
  const r = evaluateRenderSubmissionAbuse({
    activeJobsUser: 99,
    activeJobsForPack: 99,
    maxActiveUser: 0,
    maxActivePerPack: 0,
  });
  assert.equal(r.ok, true);
});

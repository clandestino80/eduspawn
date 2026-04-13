import assert from "node:assert/strict";
import test from "node:test";

import { parseKlingProviderCallback } from "./kling-callback.parse";

test("parseKlingProviderCallback", async (t) => {
  await t.test("parses flat completed payload with video.url", () => {
    const r = parseKlingProviderCallback({
      task_id: "t1",
      status: "completed",
      video: { url: "https://cdn.example.com/v.mp4" },
    });
    assert.ok(r);
    assert.equal(r!.providerJobId, "t1");
    assert.equal(r!.status, "SUCCEEDED");
    assert.equal(r!.outputUrl, "https://cdn.example.com/v.mp4");
  });

  await t.test("parses nested data.failed", () => {
    const r = parseKlingProviderCallback({
      data: { task_id: "t2", status: "failed" },
      message: "boom",
    });
    assert.ok(r);
    assert.equal(r!.status, "FAILED");
    assert.match(r!.failureReason ?? "", /boom/);
  });

  await t.test("returns null when task id missing", () => {
    assert.equal(parseKlingProviderCallback({ status: "completed" }), null);
  });
});

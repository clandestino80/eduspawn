import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../lib/errors";
import { parseNormalizedRenderWebhook } from "./render-webhook-parser";

const headers = { get: () => undefined as string | undefined };

test("parseNormalizedRenderWebhook", async (t) => {
  await t.test("parses EduSpawn envelope", () => {
    const r = parseNormalizedRenderWebhook(
      {
        provider: "KLING",
        providerJobId: "tid",
        status: "PROCESSING",
      },
      headers,
    );
    assert.equal(r.provider, "KLING");
    assert.equal(r.providerJobId, "tid");
  });

  await t.test("parses Kling-native callback body", () => {
    const r = parseNormalizedRenderWebhook(
      {
        task_id: "native-1",
        status: "completed",
        video: { url: "https://example.com/v.mp4" },
      },
      headers,
    );
    assert.equal(r.provider, "KLING");
    assert.equal(r.providerJobId, "native-1");
    assert.equal(r.status, "SUCCEEDED");
    assert.equal(r.outputUrl, "https://example.com/v.mp4");
  });

  await t.test("rejects unknown payload", () => {
    assert.throws(
      () => parseNormalizedRenderWebhook({ foo: "bar" }, headers),
      (e) => e instanceof AppError && e.code === "RENDER_WEBHOOK_PAYLOAD_INVALID",
    );
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCacheForTests } from "../../../config/env";
import { createKlingRenderAdapter } from "./kling-render.adapter";

function applyKlingEnv(overrides: Record<string, string | undefined>): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "f".repeat(32);
  process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";
  process.env.RENDER_KLING_API_KEY = "test-key";
  process.env.RENDER_KLING_API_BASE_URL = "https://api.klingapi.test";
  process.env.RENDER_KLING_MODEL = "kling-v2.6-pro";
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCacheForTests();
}

test("Kling render adapter (mocked fetch)", async (t) => {
  await t.test("submitRender maps task_id and POSTs text2video", async () => {
    applyKlingEnv({});
    let postedUrl = "";
    const fetchImpl = async (url: RequestInfo, init?: RequestInit) => {
      postedUrl = String(url);
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as { model?: string; prompt?: string; duration?: number };
      assert.equal(body.model, "kling-v2.6-pro");
      assert.ok(body.prompt && body.prompt.length > 0);
      assert.equal(body.duration, 5);
      return new Response(JSON.stringify({ task_id: "abc123" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const adapter = createKlingRenderAdapter({ fetchImpl });
    const res = await adapter.submitRender({
      renderJobId: "job1",
      userId: "u1",
      creatorPackId: "p1",
      narrative: {
        packKind: "SHORT_FORM",
        script: { title: "T", hook: "H", shortIntro: "I", shortScript: "S", titleSequenceText: "ts", voiceoverText: "v", visualCue: "c" },
        targetDurationSec: 30,
        targetPlatform: "generic",
        sourceIntent: "SYSTEM_ORIGINAL",
      },
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.providerJobId, "abc123");
    }
    assert.match(postedUrl, /\/v1\/videos\/text2video$/);
  });

  await t.test("submitRender returns error when API key missing", async () => {
    applyKlingEnv({ RENDER_KLING_API_KEY: undefined });
    const adapter = createKlingRenderAdapter();
    const res = await adapter.submitRender({
      renderJobId: "job1",
      userId: "u1",
      creatorPackId: "p1",
      narrative: {
        packKind: "SHORT_FORM",
        script: { title: "T", hook: "H", shortIntro: "I", shortScript: "S", titleSequenceText: "ts", voiceoverText: "v", visualCue: "c" },
        targetDurationSec: 30,
        targetPlatform: "generic",
        sourceIntent: "SYSTEM_ORIGINAL",
      },
    });
    assert.equal(res.ok, false);
  });

  await t.test("getRenderStatus maps completed to SUCCEEDED", async () => {
    applyKlingEnv({});
    const fetchImpl = async (url: RequestInfo) => {
      assert.match(String(url), /\/v1\/videos\/abc123$/);
      return new Response(
        JSON.stringify({
          status: "completed",
          video: { url: "https://cdn.example.com/out.mp4" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const adapter = createKlingRenderAdapter({ fetchImpl });
    const st = await adapter.getRenderStatus({ providerJobId: "abc123" });
    assert.equal(st.ok, true);
    if (st.ok) {
      assert.equal(st.status, "SUCCEEDED");
      assert.equal(st.outputUrl, "https://cdn.example.com/out.mp4");
    }
  });
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { verifyStripeWebhookBuffer } from "./adapters/stripe-webhook-verify";

const SECRET = "whsec_test_secret_for_hmac_only";

function signBody(body: Buffer, t = Math.floor(Date.now() / 1000)): string {
  const signed = Buffer.concat([Buffer.from(`${t}.`, "utf8"), body]);
  const hex = createHmac("sha256", SECRET).update(signed).digest("hex");
  return `t=${t},v1=${hex}`;
}

test("stripe webhook signature verification", async (t) => {
  await t.test("accepts valid v1 signature", () => {
    const body = Buffer.from(
      JSON.stringify({
        id: "evt_test_1",
        type: "ping",
        data: { object: { x: 1 } },
      }),
      "utf8",
    );
    const header = signBody(body);
    const ev = verifyStripeWebhookBuffer(body, header, SECRET);
    assert.equal(ev.id, "evt_test_1");
    assert.equal(ev.type, "ping");
  });

  await t.test("rejects bad signature", () => {
    const body = Buffer.from('{"id":"evt_x","type":"t","data":{"object":{}}}', "utf8");
    assert.throws(
      () => verifyStripeWebhookBuffer(body, "t=1,v1=deadbeef", SECRET),
      (e: unknown) => e instanceof Error && /stripe_signature_mismatch|malformed_stripe_signature/.test(e.message),
    );
  });
});

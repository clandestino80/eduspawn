import { createHmac, timingSafeEqual } from "node:crypto";

const TIMESTAMP_TOLERANCE_SEC = 300;

export type StripeWebhookEventJson = {
  id: string;
  type: string;
  /** Unix seconds when Stripe created the Event object (replay / age guards). */
  created?: number;
  data: { object: unknown };
  [key: string]: unknown;
};

/**
 * Verifies `Stripe-Signature` per Stripe’s scheme (HMAC-SHA256 of `{t}.{rawBodyUtf8}`).
 * @throws Error with short code in message on failure
 */
export function verifyStripeWebhookBuffer(
  rawBody: Buffer,
  stripeSignatureHeader: string | undefined,
  webhookSecret: string,
): StripeWebhookEventJson {
  if (!stripeSignatureHeader?.trim()) {
    throw new Error("missing_stripe_signature");
  }
  const parts = stripeSignatureHeader.split(",").map((s) => s.trim());
  let timestamp = "";
  const v1Signatures: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === "t") timestamp = val;
    if (key === "v1" && val.length > 0) v1Signatures.push(val);
  }
  if (!timestamp || v1Signatures.length === 0) {
    throw new Error("malformed_stripe_signature");
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    throw new Error("invalid_stripe_timestamp");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > TIMESTAMP_TOLERANCE_SEC) {
    throw new Error("stripe_timestamp_out_of_tolerance");
  }

  const signedContent = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody]);
  const expectedHex = createHmac("sha256", webhookSecret).update(signedContent).digest("hex");
  const expectedBuf = Buffer.from(expectedHex, "utf8");

  const match = v1Signatures.some((hexSig) => {
    try {
      const sigBuf = Buffer.from(hexSig, "hex");
      if (sigBuf.length !== expectedBuf.length) return false;
      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });
  if (!match) {
    throw new Error("stripe_signature_mismatch");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    throw new Error("invalid_stripe_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_stripe_event_shape");
  }
  const ev = parsed as Record<string, unknown>;
  const id = ev.id;
  const type = ev.type;
  const data = ev.data;
  if (typeof id !== "string" || typeof type !== "string") {
    throw new Error("invalid_stripe_event_fields");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("invalid_stripe_event_data");
  }
  const d = data as Record<string, unknown>;
  if (!("object" in d)) {
    throw new Error("invalid_stripe_event_data_object");
  }
  return ev as unknown as StripeWebhookEventJson;
}

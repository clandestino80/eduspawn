import type { Request, Response } from "express";

import { ingestStripeWebhook } from "./services/billing-provider-event.service";

function rawBodyAsBuffer(req: Request): Buffer {
  const raw = req.body;
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    return Buffer.from(raw, "utf8");
  }
  return Buffer.from(JSON.stringify(raw ?? {}), "utf8");
}

/** Stripe webhooks — requires `express.raw` on this route so the signature matches Stripe’s payload. */
export async function postStripeBillingWebhookController(req: Request, res: Response): Promise<void> {
  const buf = rawBodyAsBuffer(req);
  const sig = req.headers["stripe-signature"];
  const sigStr = typeof sig === "string" ? sig : Array.isArray(sig) ? sig[0] : undefined;
  const { httpStatus, body } = await ingestStripeWebhook(buf, sigStr);
  res.status(httpStatus).json(body);
}

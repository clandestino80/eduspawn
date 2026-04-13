import { getEnv } from "../../../config/env";
import { AppError } from "../../../lib/errors";
import type { WebhookHeaderBag } from "../render-provider.types";

/**
 * Optional replay / clock-skew guard when a vendor (or proxy) sends `X-Webhook-Timestamp`.
 *
 * Kling’s public page https://klingapi.com/docs does not document this header for callbacks; keep
 * `RENDER_WEBHOOK_SECRET` as the primary ingress gate. When the header is absent, this check is a no-op.
 */
export function assertWebhookClockSkew(headers: WebhookHeaderBag): void {
  const max = getEnv().RENDER_WEBHOOK_MAX_CLOCK_SKEW_SEC;
  if (max <= 0) return;
  const ts = headers.get("x-webhook-timestamp");
  if (!ts?.trim()) return;
  const sec = Number(ts.trim());
  if (!Number.isFinite(sec)) return;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - sec) > max) {
    throw new AppError(401, "Webhook timestamp outside allowed window", { code: "RENDER_WEBHOOK_STALE" });
  }
}

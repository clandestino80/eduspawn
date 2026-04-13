import { AppError } from "../../../lib/errors";
import { createKlingRenderAdapter } from "../adapters/kling-render.adapter";
import { renderProviderWebhookBodySchema } from "../schemas/render-request.schema";
import type { ParsedProviderWebhook, WebhookHeaderBag } from "../render-provider.types";

/**
 * Accept either EduSpawn’s explicit envelope or a vendor-native Kling callback body.
 */
export function parseNormalizedRenderWebhook(raw: unknown, headers: WebhookHeaderBag): ParsedProviderWebhook {
  const envelope = renderProviderWebhookBodySchema.safeParse(raw);
  if (envelope.success) {
    const d = envelope.data;
    const parsed: ParsedProviderWebhook = {
      provider: d.provider,
      providerJobId: d.providerJobId,
      status: d.status,
    };
    if (d.outputUrl !== undefined) parsed.outputUrl = d.outputUrl;
    if (d.thumbnailUrl !== undefined) parsed.thumbnailUrl = d.thumbnailUrl;
    if (d.failureReason !== undefined) parsed.failureReason = d.failureReason;
    return parsed;
  }

  const kling = createKlingRenderAdapter().parseProviderWebhook?.(raw, headers);
  if (kling) return kling;

  throw new AppError(400, "Unrecognized render webhook payload", {
    code: "RENDER_WEBHOOK_PAYLOAD_INVALID",
  });
}

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
    return {
      provider: d.provider,
      providerJobId: d.providerJobId,
      status: d.status,
      outputUrl: d.outputUrl,
      thumbnailUrl: d.thumbnailUrl,
      failureReason: d.failureReason,
    };
  }

  const kling = createKlingRenderAdapter().parseProviderWebhook?.(raw, headers);
  if (kling) return kling;

  throw new AppError(400, "Unrecognized render webhook payload", {
    code: "RENDER_WEBHOOK_PAYLOAD_INVALID",
  });
}

import { z } from "zod";

export const createRenderJobBodySchema = z.object({
  creatorPackId: z.string().cuid(),
  useEditedPack: z.boolean(),
  targetDurationSec: z.number().int().min(5).max(7200).optional(),
  targetPlatform: z.string().min(1).max(64).optional(),
  renderPreset: z.string().max(64).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  providerOverride: z.enum(["KLING", "KLING_STUB"]).optional(),
});

export type CreateRenderJobBody = z.infer<typeof createRenderJobBodySchema>;

export const renderJobIdParamsSchema = z.object({ jobId: z.string().cuid() });

export const listRenderJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const renderProviderWebhookBodySchema = z.object({
  provider: z.enum(["KLING", "KLING_STUB"]),
  providerJobId: z.string().min(1).max(512),
  status: z.enum(["PROCESSING", "SUCCEEDED", "FAILED"]),
  outputUrl: z.string().url().max(4000).optional(),
  thumbnailUrl: z.string().url().max(4000).optional(),
  failureReason: z.string().max(4000).optional(),
});

export type RenderProviderWebhookBody = z.infer<typeof renderProviderWebhookBodySchema>;

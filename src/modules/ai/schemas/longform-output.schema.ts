import { z } from "zod";

export const longformSceneSchema = z.object({
  sceneNumber: z.number().int().positive(),
  sceneTitle: z.string().min(1),
  durationSeconds: z.number().int().positive(),
  goal: z.string().min(1),
  narration: z.string().min(1),
  visualDirection: z.string().min(1),
  onScreenText: z.string().min(1),
  transitionNote: z.string().min(1),
});

export const longformVideoOutputSchema = z.object({
  title: z.string().min(1),
  targetAudience: z.string().min(1),
  durationMinutes: z.number().min(1).max(30),
  tone: z.string().min(1),
  structure: z.array(longformSceneSchema).min(1),
  closingSummary: z.string().min(1),
  cta: z.string().min(1),
});

export const longformQualityMetaSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  routeReason: z.string().min(1),
});

export const longformVideoResultSchema = longformVideoOutputSchema.extend({
  qualityMeta: longformQualityMetaSchema,
});

export type LongformScene = z.infer<typeof longformSceneSchema>;
export type LongformVideoOutput = z.infer<typeof longformVideoOutputSchema>;
export type LongformQualityMeta = z.infer<typeof longformQualityMetaSchema>;
export type LongformVideoResult = z.infer<typeof longformVideoResultSchema>;

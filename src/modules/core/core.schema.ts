import { z } from "zod";

export const coreSessionIdParamSchema = z.object({
  id: z.string().min(1),
});

/** GET /core/sessions — read-only list for the authenticated user. */
export const listLearningSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  cursor: z.string().trim().min(1).max(512).optional(),
});

export type ListLearningSessionsQuery = z.infer<typeof listLearningSessionsQuerySchema>;

export const upsertLearningDnaSchema = z.object({
  preferredTone: z.string().trim().min(1).max(60).optional(),
  preferredDifficulty: z.string().trim().min(1).max(40).optional(),
  favoriteTopics: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  attentionSpanSeconds: z.number().int().positive().max(7200).optional(),
  visualPreference: z.string().trim().min(1).max(80).optional(),
  quizPreference: z.string().trim().min(1).max(80).optional(),
  language: z.string().trim().min(1).max(30).optional(),
});

export const createLearningSessionSchema = z.object({
  topic: z.string().trim().min(2).max(180),
  curiosityPrompt: z.string().trim().min(5).max(2000),
  difficulty: z.string().trim().min(1).max(40).optional(),
  tone: z.string().trim().min(1).max(60).optional(),
  /** Slice G — optional `GlobalTopicInventory.id` when starting from the memory-first topic feed. */
  sourceGlobalTopicId: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.string().trim().min(12).max(128).optional(),
    ),
});

export const createQuizAttemptSchema = z.object({
  answersJson: z.record(z.any()),
  totalQuestions: z.number().int().positive().max(200).optional(),
  /** Ignored when server computes score from stored quiz questions */
  score: z.number().int().min(0).max(100).optional(),
  feedback: z.string().trim().max(4000).optional(),
});

export const outputTypeSchema = z.enum([
  "tiktok_script",
  "instagram_reel",
  "youtube_short",
  // Backward compatibility aliases:
  "short_video_script",
  "carousel_post",
  "narration",
  "image_prompt",
]);

export const createContentOutputSchema = z.object({
  outputType: outputTypeSchema,
});

export const createLongformSchema = z.object({
  durationMinutes: z.number().int().min(1).max(30),
  targetAudience: z.string().trim().min(1).max(500).optional(),
  tone: z.string().trim().min(1).max(60).optional(),
});

export const sharePlatformSchema = z.enum(["tiktok", "instagram", "youtube"]);

export const recordContentShareSchema = z.object({
  platform: sharePlatformSchema,
});

export type UpsertLearningDnaInput = z.infer<typeof upsertLearningDnaSchema>;
export type CreateLearningSessionInput = z.infer<typeof createLearningSessionSchema>;
export type CreateQuizAttemptInput = z.infer<typeof createQuizAttemptSchema>;
export type CreateContentOutputInput = z.infer<typeof createContentOutputSchema>;
export type CreateLongformInput = z.infer<typeof createLongformSchema>;
export type RecordContentShareInput = z.infer<typeof recordContentShareSchema>;

import { z } from "zod";

export const creatorGenerationGoalSchema = z.enum([
  "short_video",
  "long_form_creator_pack",
  "learning_to_content",
]);

export const creatorTargetPlatformSchema = z.enum([
  "tiktok",
  "reels",
  "youtube_shorts",
  "youtube_long",
  "generic",
]);

export const creatorGenerationRequestSchema = z.object({
  topic: z.string().min(1).max(500),
  curiosityPrompt: z.string().min(1).max(4000),
  goal: creatorGenerationGoalSchema,
  durationSec: z.number().int().min(5).max(7200),
  targetPlatform: creatorTargetPlatformSchema,
  presetKey: z.string().max(120).optional(),
  tone: z.string().min(1).max(120),
  audience: z.string().min(1).max(300),
  language: z.string().min(1).max(64),
  ctaStyle: z.string().max(200).optional(),
  endingStyle: z.string().max(200).optional(),
  learningSessionId: z.string().cuid().optional(),
});

export type CreatorGenerationGoal = z.infer<typeof creatorGenerationGoalSchema>;
export type CreatorTargetPlatform = z.infer<typeof creatorTargetPlatformSchema>;
export type CreatorGenerationRequest = z.infer<typeof creatorGenerationRequestSchema>;

export const patchUserCreatorPackBodySchema = z.object({
  userEditedPack: z.unknown(),
});

export type PatchUserCreatorPackBody = z.infer<typeof patchUserCreatorPackBodySchema>;

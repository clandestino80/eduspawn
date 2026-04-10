import { z } from "zod";
import { AI_TASK_TYPES, PLAN_TIERS } from "../providers/ai-provider.types";

export const aiTaskTypeSchema = z.enum(AI_TASK_TYPES);
export const planTierSchema = z.enum(PLAN_TIERS);

export const aiMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

export const aiGenerationRequestSchema = z.object({
  taskType: aiTaskTypeSchema,
  planTier: planTierSchema,
  messages: z.array(aiMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32768).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const aiGenerationOutputSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
  model: z.string().min(1),
  content: z.string().min(1),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
  finishReason: z.enum(["stop", "length", "tool_use", "unknown"]),
  raw: z.record(z.unknown()),
});

export type AiGenerationRequest = z.infer<typeof aiGenerationRequestSchema>;
export type AiGenerationOutput = z.infer<typeof aiGenerationOutputSchema>;

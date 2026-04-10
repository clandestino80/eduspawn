export const AI_TASK_TYPES = [
  "lesson_generation",
  "quiz_generation",
  "short_video_script",
  "carousel_post",
  "narration",
  "image_prompt",
  "long_video_script",
  "critic_review",
] as const;

export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const PLAN_TIERS = ["free", "pro", "premium"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export type AiProviderName = "openai" | "anthropic" | "gemini";

export type AiMessageRole = "system" | "user" | "assistant";

export type AiMessage = {
  role: AiMessageRole;
  content: string;
};

export type AiGenerationInput = {
  taskType: AiTaskType;
  planTier: PlanTier;
  messages: AiMessage[];

  temperature?: number;
  maxTokens?: number;

  responseFormat?: "text" | "json";

  metadata?: {
    userId?: string;
    sessionId?: string;
    durationMinutes?: number;
    language?: string;
    difficulty?: string;
    tone?: string;
    [key: string]: unknown;
  };
};

export type AiGenerationOutput = {
  provider: AiProviderName;
  model: string;

  // ⚠️ artık string değil
  content: unknown;

  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  costEstimate?: number;
  latencyMs?: number;

  finishReason: "stop" | "length" | "tool_use" | "unknown";

  raw: Record<string, unknown>;
};

export type ModelRouteDecision = {
  provider: AiProviderName;
  model: string;

  taskType: AiTaskType;
  planTier: PlanTier;

  reasoning: string;

  maxTokens: number;
  temperature: number;

  responseFormat: "text" | "json";

  qualityLevel: "low_cost" | "standard" | "high" | "premium" | "multi_pass";

  multiPass?: boolean;
  passCount?: number;
};

export interface AiProvider {
  readonly name: AiProviderName;

  generate(
    input: AiGenerationInput,
    route: ModelRouteDecision
  ): Promise<AiGenerationOutput>;
}
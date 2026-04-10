// model-router.service.ts (FINAL)

import { AnthropicProvider } from "../providers/anthropic.provider";
import { GeminiProvider } from "../providers/gemini.provider";
import { OpenAiProvider } from "../providers/openai.provider";
import type {
  AiGenerationInput,
  AiGenerationOutput,
  AiProvider,
  AiProviderName,
  AiTaskType,
  ModelRouteDecision,
  PlanTier,
} from "../providers/ai-provider.types";

type RouteProfile = {
  provider: AiProviderName;
  model: string;
  reasoning: string;
  maxTokens: number;
  temperature: number;
  qualityLevel: ModelRouteDecision["qualityLevel"];
  responseFormat: "text" | "json";
  multiPass?: boolean;
  passCount?: number;
};

type RouteByTier = Record<PlanTier, RouteProfile>;

const DEFAULT_MODELS = {
  openaiFast: "gpt-4o-mini",
  openaiSmart: "gpt-5",

  anthropicFast: "claude-haiku-4-5",
  anthropicBalanced: "claude-sonnet-4-6",
  anthropicPremium: "claude-opus-4-6",

  geminiFast: "gemini-2.5-flash",
  geminiSmart: "gemini-2.5-pro",
} as const;

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function firstDefinedEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readEnv(key);
    if (value) return value;
  }
  return undefined;
}

function resolveModel(keys: string[], fallback: string): string {
  return firstDefinedEnv(...keys) ?? fallback;
}

function normalizePlanTier(value?: string | null): PlanTier {
  const normalized = (value ?? readEnv("DEFAULT_PLAN_TIER") ?? "free").toLowerCase();

  if (normalized === "free" || normalized === "pro" || normalized === "premium") {
    return normalized;
  }

  return "free";
}

/**
 * Supported env patterns
 *
 * Generic provider-level envs:
 * - OPENAI_MODEL_FAST
 * - OPENAI_MODEL_SMART
 * - ANTHROPIC_MODEL_FAST
 * - ANTHROPIC_MODEL_BALANCED
 * - ANTHROPIC_MODEL_PREMIUM
 * - GEMINI_MODEL_FAST
 * - GEMINI_MODEL_SMART
 *
 * Legacy fallback envs:
 * - OPENAI_MODEL
 * - ANTHROPIC_MODEL
 * - GEMINI_MODEL
 *
 * Optional task-specific override envs:
 * - LESSON_FREE_MODEL / LESSON_PRO_MODEL / LESSON_PREMIUM_MODEL
 * - SHORT_VIDEO_FREE_MODEL / SHORT_VIDEO_PRO_MODEL / SHORT_VIDEO_PREMIUM_MODEL
 * - LONG_VIDEO_FREE_MODEL / LONG_VIDEO_PRO_MODEL / LONG_VIDEO_PREMIUM_MODEL
 * - CRITIC_FREE_MODEL / CRITIC_PRO_MODEL / CRITIC_PREMIUM_MODEL
 * - QUIZ_FREE_MODEL / QUIZ_PRO_MODEL / QUIZ_PREMIUM_MODEL
 * - CAROUSEL_FREE_MODEL / CAROUSEL_PRO_MODEL / CAROUSEL_PREMIUM_MODEL
 * - NARRATION_FREE_MODEL / NARRATION_PRO_MODEL / NARRATION_PREMIUM_MODEL
 * - IMAGE_PROMPT_FREE_MODEL / IMAGE_PROMPT_PRO_MODEL / IMAGE_PROMPT_PREMIUM_MODEL
 */
const MODELS = {
  openaiFast: resolveModel(
    ["OPENAI_MODEL_FAST", "OPENAI_MODEL"],
    DEFAULT_MODELS.openaiFast
  ),
  openaiSmart: resolveModel(
    ["OPENAI_MODEL_SMART", "OPENAI_MODEL"],
    DEFAULT_MODELS.openaiSmart
  ),

  anthropicFast: resolveModel(
    ["ANTHROPIC_MODEL_FAST", "ANTHROPIC_MODEL"],
    DEFAULT_MODELS.anthropicFast
  ),
  anthropicBalanced: resolveModel(
    ["ANTHROPIC_MODEL_BALANCED", "ANTHROPIC_MODEL"],
    DEFAULT_MODELS.anthropicBalanced
  ),
  anthropicPremium: resolveModel(
    ["ANTHROPIC_MODEL_PREMIUM", "ANTHROPIC_MODEL_BALANCED", "ANTHROPIC_MODEL"],
    DEFAULT_MODELS.anthropicPremium
  ),

  geminiFast: resolveModel(
    ["GEMINI_MODEL_FAST", "GEMINI_MODEL"],
    DEFAULT_MODELS.geminiFast
  ),
  geminiSmart: resolveModel(
    ["GEMINI_MODEL_SMART", "GEMINI_MODEL"],
    DEFAULT_MODELS.geminiSmart
  ),
} as const;

const ROUTING_TABLE: Record<AiTaskType, RouteByTier> = {
  lesson_generation: {
    free: {
  provider: "openai",
  model: resolveModel(
    ["LESSON_FREE_MODEL", "OPENAI_LESSON_MODEL", "OPENAI_MODEL_FAST", "OPENAI_MODEL"],
    "gpt-4o-mini"
  ),
  reasoning: "Free tier lesson generation temporarily uses OpenAI for stability.",
  maxTokens: 1400,
  temperature: 0.7,
  qualityLevel: "low_cost",
  responseFormat: "json",
},
    pro: {
      provider: "openai",
      model: resolveModel(
        ["LESSON_PRO_MODEL", "OPENAI_LESSON_MODEL", "OPENAI_MODEL_SMART", "OPENAI_MODEL"],
        MODELS.openaiSmart
      ),
      reasoning: "Pro tier lessons use a stronger balanced model for better pedagogy and structure.",
      maxTokens: 2200,
      temperature: 0.6,
      qualityLevel: "high",
      responseFormat: "json",
    },
    premium: {
      provider: "anthropic",
      model: resolveModel(
        [
          "LESSON_PREMIUM_MODEL",
          "ANTHROPIC_LESSON_MODEL",
          "ANTHROPIC_MODEL_PREMIUM",
          "ANTHROPIC_MODEL_BALANCED",
          "ANTHROPIC_MODEL",
        ],
        MODELS.anthropicPremium
      ),
      reasoning: "Premium lessons use the strongest model for deeper clarity, teaching quality, and refinement.",
      maxTokens: 3000,
      temperature: 0.55,
      qualityLevel: "premium",
      responseFormat: "json",
    },
  },

  short_video_script: {
    free: {
      provider: "openai",
      model: resolveModel(
        [
          "SHORT_VIDEO_FREE_MODEL",
          "SHORTFORM_FREE_MODEL",
          "OPENAI_SHORTFORM_MODEL",
          "OPENAI_MODEL_FAST",
          "OPENAI_MODEL",
        ],
        MODELS.openaiFast
      ),
      reasoning: "Free short-form generation prioritizes speed and low cost.",
      maxTokens: 800,
      temperature: 0.8,
      qualityLevel: "low_cost",
      responseFormat: "text",
    },
    pro: {
      provider: "openai",
      model: resolveModel(
        [
          "SHORT_VIDEO_PRO_MODEL",
          "SHORTFORM_PRO_MODEL",
          "OPENAI_SHORTFORM_MODEL",
          "OPENAI_MODEL_SMART",
          "OPENAI_MODEL",
        ],
        MODELS.openaiSmart
      ),
      reasoning: "Pro short-form generation uses a smarter model for better hooks, pacing, and CTA quality.",
      maxTokens: 1100,
      temperature: 0.75,
      qualityLevel: "high",
      responseFormat: "text",
    },
    premium: {
      provider: "openai",
      model: resolveModel(
        [
          "SHORT_VIDEO_PREMIUM_MODEL",
          "SHORTFORM_PREMIUM_MODEL",
          "OPENAI_SHORTFORM_MODEL",
          "OPENAI_MODEL_SMART",
          "OPENAI_MODEL",
        ],
        MODELS.openaiSmart
      ),
      reasoning: "Premium short-form still favors fast, high-quality output rather than heavyweight long-form reasoning.",
      maxTokens: 1400,
      temperature: 0.72,
      qualityLevel: "premium",
      responseFormat: "text",
    },
  },

  long_video_script: {
    free: {
      provider: "gemini",
      model: resolveModel(
        ["LONG_VIDEO_FREE_MODEL", "LONGFORM_FREE_MODEL", "GEMINI_LONGFORM_MODEL", "GEMINI_MODEL_FAST", "GEMINI_MODEL"],
        MODELS.geminiFast
      ),
      reasoning: "Free long-form generation returns a lighter outline using an economical long-context model.",
      maxTokens: 2600,
      temperature: 0.55,
      qualityLevel: "standard",
      responseFormat: "json",
    },
    pro: {
      provider: "anthropic",
      model: resolveModel(
        [
          "LONG_VIDEO_PRO_MODEL",
          "LONGFORM_PRO_MODEL",
          "ANTHROPIC_LONGFORM_MODEL",
          "ANTHROPIC_MODEL_BALANCED",
          "ANTHROPIC_MODEL",
        ],
        MODELS.anthropicBalanced
      ),
      reasoning: "Pro long-form generation uses a stronger balanced model for structured multi-scene educational scripts.",
      maxTokens: 5200,
      temperature: 0.5,
      qualityLevel: "high",
      responseFormat: "json",
    },
    premium: {
      provider: "anthropic",
      model: resolveModel(
        [
          "LONG_VIDEO_PREMIUM_MODEL",
          "LONGFORM_PREMIUM_MODEL",
          "ANTHROPIC_LONGFORM_MODEL",
          "ANTHROPIC_MODEL_PREMIUM",
          "ANTHROPIC_MODEL_BALANCED",
          "ANTHROPIC_MODEL",
        ],
        MODELS.anthropicPremium
      ),
      reasoning: "Premium long-form generation uses the strongest model with multi-pass quality for academic-grade outputs.",
      maxTokens: 7200,
      temperature: 0.45,
      qualityLevel: "multi_pass",
      responseFormat: "json",
      multiPass: true,
      passCount: 2,
    },
  },

  critic_review: {
    free: {
      provider: "openai",
      model: resolveModel(
        ["CRITIC_FREE_MODEL", "REVIEW_FREE_MODEL", "OPENAI_CRITIC_MODEL", "OPENAI_MODEL_FAST", "OPENAI_MODEL"],
        MODELS.openaiFast
      ),
      reasoning: "Free review uses a fast model for lightweight structural checks.",
      maxTokens: 1200,
      temperature: 0.25,
      qualityLevel: "standard",
      responseFormat: "json",
    },
    pro: {
      provider: "anthropic",
      model: resolveModel(
        [
          "CRITIC_PRO_MODEL",
          "REVIEW_PRO_MODEL",
          "ANTHROPIC_CRITIC_MODEL",
          "ANTHROPIC_MODEL_BALANCED",
          "ANTHROPIC_MODEL",
        ],
        MODELS.anthropicBalanced
      ),
      reasoning: "Pro critique uses a stronger model for better precision, pedagogy feedback, and rewrite guidance.",
      maxTokens: 2400,
      temperature: 0.2,
      qualityLevel: "high",
      responseFormat: "json",
    },
    premium: {
      provider: "anthropic",
      model: resolveModel(
        [
          "CRITIC_PREMIUM_MODEL",
          "REVIEW_PREMIUM_MODEL",
          "ANTHROPIC_CRITIC_MODEL",
          "ANTHROPIC_MODEL_PREMIUM",
          "ANTHROPIC_MODEL_BALANCED",
          "ANTHROPIC_MODEL",
        ],
        MODELS.anthropicPremium
      ),
      reasoning: "Premium critique uses the strongest model with multi-pass review for deep quality control.",
      maxTokens: 3400,
      temperature: 0.15,
      qualityLevel: "multi_pass",
      responseFormat: "json",
      multiPass: true,
      passCount: 2,
    },
  },

  quiz_generation: {
    free: {
      provider: "gemini",
      model: resolveModel(
        ["QUIZ_FREE_MODEL", "GEMINI_QUIZ_MODEL", "GEMINI_MODEL_FAST", "GEMINI_MODEL"],
        MODELS.geminiFast
      ),
      reasoning: "Free quiz generation uses a fast low-cost model for basic assessment coverage.",
      maxTokens: 1400,
      temperature: 0.45,
      qualityLevel: "low_cost",
      responseFormat: "json",
    },
    pro: {
      provider: "openai",
      model: resolveModel(
        ["QUIZ_PRO_MODEL", "OPENAI_QUIZ_MODEL", "OPENAI_MODEL_FAST", "OPENAI_MODEL"],
        MODELS.openaiFast
      ),
      reasoning: "Pro quiz generation improves distractor quality and consistency while staying efficient.",
      maxTokens: 2000,
      temperature: 0.4,
      qualityLevel: "standard",
      responseFormat: "json",
    },
    premium: {
      provider: "anthropic",
      model: resolveModel(
        [
          "QUIZ_PREMIUM_MODEL",
          "ANTHROPIC_QUIZ_MODEL",
          "ANTHROPIC_MODEL_BALANCED",
          "ANTHROPIC_MODEL_PREMIUM",
          "ANTHROPIC_MODEL",
        ],
        MODELS.anthropicBalanced
      ),
      reasoning: "Premium quiz generation uses a stronger model for higher-precision question quality and explanation depth.",
      maxTokens: 2800,
      temperature: 0.35,
      qualityLevel: "premium",
      responseFormat: "json",
    },
  },

  carousel_post: {
    free: {
      provider: "gemini",
      model: resolveModel(
        ["CAROUSEL_FREE_MODEL", "GEMINI_CAROUSEL_MODEL", "GEMINI_MODEL_FAST", "GEMINI_MODEL"],
        MODELS.geminiFast
      ),
      reasoning: "Free carousel generation prioritizes speed and cost efficiency.",
      maxTokens: 1200,
      temperature: 0.7,
      qualityLevel: "low_cost",
      responseFormat: "json",
    },
    pro: {
      provider: "openai",
      model: resolveModel(
        ["CAROUSEL_PRO_MODEL", "OPENAI_CAROUSEL_MODEL", "OPENAI_MODEL_SMART", "OPENAI_MODEL"],
        MODELS.openaiSmart
      ),
      reasoning: "Pro carousel generation improves persuasion, hooks, and slide sequencing.",
      maxTokens: 1800,
      temperature: 0.65,
      qualityLevel: "standard",
      responseFormat: "json",
    },
    premium: {
      provider: "anthropic",
      model: resolveModel(
        [
          "CAROUSEL_PREMIUM_MODEL",
          "ANTHROPIC_CAROUSEL_MODEL",
          "ANTHROPIC_MODEL_BALANCED",
          "ANTHROPIC_MODEL_PREMIUM",
          "ANTHROPIC_MODEL",
        ],
        MODELS.anthropicBalanced
      ),
      reasoning: "Premium carousel generation emphasizes narrative flow and higher persuasion quality.",
      maxTokens: 2400,
      temperature: 0.6,
      qualityLevel: "premium",
      responseFormat: "json",
    },
  },

  narration: {
    free: {
      provider: "gemini",
      model: resolveModel(
        ["NARRATION_FREE_MODEL", "GEMINI_NARRATION_MODEL", "GEMINI_MODEL_FAST", "GEMINI_MODEL"],
        MODELS.geminiFast
      ),
      reasoning: "Free narration uses a low-cost fast model for clean draft voiceover text.",
      maxTokens: 1400,
      temperature: 0.6,
      qualityLevel: "low_cost",
      responseFormat: "json",
    },
    pro: {
      provider: "openai",
      model: resolveModel(
        ["NARRATION_PRO_MODEL", "OPENAI_NARRATION_MODEL", "OPENAI_MODEL_SMART", "OPENAI_MODEL"],
        MODELS.openaiSmart
      ),
      reasoning: "Pro narration improves fluency, rhythm, and spoken clarity.",
      maxTokens: 2200,
      temperature: 0.55,
      qualityLevel: "standard",
      responseFormat: "json",
    },
    premium: {
      provider: "anthropic",
      model: resolveModel(
        [
          "NARRATION_PREMIUM_MODEL",
          "ANTHROPIC_NARRATION_MODEL",
          "ANTHROPIC_MODEL_BALANCED",
          "ANTHROPIC_MODEL_PREMIUM",
          "ANTHROPIC_MODEL",
        ],
        MODELS.anthropicBalanced
      ),
      reasoning: "Premium narration uses a stronger model for higher naturalness and storytelling flow.",
      maxTokens: 3000,
      temperature: 0.5,
      qualityLevel: "high",
      responseFormat: "json",
    },
  },

  image_prompt: {
    free: {
      provider: "openai",
      model: resolveModel(
        ["IMAGE_PROMPT_FREE_MODEL", "OPENAI_IMAGE_PROMPT_MODEL", "OPENAI_MODEL_FAST", "OPENAI_MODEL"],
        MODELS.openaiFast
      ),
      reasoning: "Free image prompt generation uses a fast model for concise visual direction.",
      maxTokens: 700,
      temperature: 0.75,
      qualityLevel: "low_cost",
      responseFormat: "json",
    },
    pro: {
      provider: "openai",
      model: resolveModel(
        ["IMAGE_PROMPT_PRO_MODEL", "OPENAI_IMAGE_PROMPT_MODEL", "OPENAI_MODEL_SMART", "OPENAI_MODEL"],
        MODELS.openaiSmart
      ),
      reasoning: "Pro image prompt generation adds better visual specificity and composition detail.",
      maxTokens: 1100,
      temperature: 0.7,
      qualityLevel: "high",
      responseFormat: "json",
    },
    premium: {
      provider: "gemini",
      model: resolveModel(
        [
          "IMAGE_PROMPT_PREMIUM_MODEL",
          "GEMINI_IMAGE_PROMPT_MODEL",
          "GEMINI_MODEL_SMART",
          "GEMINI_MODEL",
        ],
        MODELS.geminiSmart
      ),
      reasoning: "Premium image prompt generation uses a stronger model for richer concept depth and visual planning.",
      maxTokens: 1400,
      temperature: 0.65,
      qualityLevel: "premium",
      responseFormat: "json",
    },
  },
};

const PROVIDER_REGISTRY: Record<AiProviderName, AiProvider> = {
  openai: new OpenAiProvider(),
  anthropic: new AnthropicProvider(),
  gemini: new GeminiProvider(),
};

export function getModelRoute(taskType: AiTaskType, planTier: PlanTier): ModelRouteDecision {
  const normalizedPlanTier = normalizePlanTier(planTier);
  const taskRoutes = ROUTING_TABLE[taskType];

  if (!taskRoutes) {
    throw new Error(`No model route configured for task type: ${taskType}`);
  }

  const route = taskRoutes[normalizedPlanTier];

  if (!route) {
    throw new Error(
      `No model route configured for task type "${taskType}" and plan tier "${normalizedPlanTier}"`
    );
  }

  const decision: ModelRouteDecision = {
    taskType,
    planTier: normalizedPlanTier,
    provider: route.provider,
    model: route.model,
    reasoning: route.reasoning,
    maxTokens: route.maxTokens,
    temperature: route.temperature,
    qualityLevel: route.qualityLevel,
    responseFormat: route.responseFormat,
  };

  if (route.multiPass !== undefined) {
    decision.multiPass = route.multiPass;
  }

  if (route.passCount !== undefined) {
    decision.passCount = route.passCount;
  }

  return decision;
}

export function getProvider(providerName: AiProviderName): AiProvider {
  const provider = PROVIDER_REGISTRY[providerName];

  if (!provider) {
    throw new Error(`Unknown AI provider: ${providerName}`);
  }

  return provider;
}

export async function runAiTask(input: AiGenerationInput): Promise<AiGenerationOutput> {
  const normalizedPlanTier = normalizePlanTier(input.planTier);
  const normalizedInput: AiGenerationInput = {
    ...input,
    planTier: normalizedPlanTier,
  };

  const route = getModelRoute(normalizedInput.taskType, normalizedInput.planTier);
  const provider = getProvider(route.provider);

  return provider.generate(normalizedInput, route);
}
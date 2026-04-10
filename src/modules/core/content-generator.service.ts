import { runAiTask } from "../ai/router/model-router.service";
import type { PlanTier } from "../ai/providers/ai-provider.types";
import type { CreateContentOutputInput } from "./core.schema";
import {
  buildDeterministicViralPayload,
  computeDynamicViralityScore,
  mapOutputToPlatform,
  resolveContentTaskType,
  resolvePlanTier,
  type ViralPayload,
} from "./viral-engine.service";

type LessonSource = {
  lessonTitle: string;
  lessonSummary: string;
  lessonBody: string;
};

type GeneratedContentOutput = {
  title: string;
  content: string;
  metaJson: Record<string, unknown>;
};

type GenerateContentOptions = {
  planTier?: PlanTier;
  shareCount?: number;
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function parseViralPayload(raw: unknown): ViralPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.hook !== "string" ||
    typeof r.script !== "string" ||
    typeof r.cta !== "string" ||
    typeof r.viralityScore !== "number" ||
    !Array.isArray(r.emotionalTriggers)
  ) {
    return null;
  }
  const emotionalTriggers = r.emotionalTriggers.filter((x) => typeof x === "string") as string[];
  const dynamic = computeDynamicViralityScore({
    hook: String(r.hook),
    script: String(r.script),
    emotionalTriggers,
    shareCount: 0,
  });
  return {
    hook: normalizeText(r.hook),
    script: String(r.script),
    cta: normalizeText(r.cta),
    // Always normalized via dynamic scoring logic
    viralityScore: dynamic.viralityScore,
    emotionalTriggers,
    breakdown: dynamic.breakdown,
  };
}

function renderPayloadToContent(payload: ViralPayload): string {
  return [`HOOK: ${payload.hook}`, "", payload.script, "", `CTA: ${payload.cta}`].join("\n");
}

async function tryAiEnhancePayload(
  outputType: CreateContentOutputInput["outputType"],
  lesson: LessonSource,
  fallback: ViralPayload,
  planTier: PlanTier,
): Promise<{ payload: ViralPayload; aiUsed: boolean; routeReason?: string; model?: string; provider?: string }> {
  const platform = mapOutputToPlatform(outputType);
  const taskType = resolveContentTaskType(platform);
  try {
    const output = await runAiTask({
      taskType,
      planTier,
      responseFormat: "json",
      messages: [
        {
          role: "system",
          content:
            "You are a viral content strategist. Return ONLY JSON: {hook, script, cta, viralityScore, emotionalTriggers}.",
        },
        {
          role: "user",
          content: JSON.stringify({
            platform,
            lesson,
            rules: [
              "Hook must hit in first 2 seconds",
              "Create curiosity gap",
              "Use emotional triggers",
              "Add clear CTA",
              "Optimize for shareability",
            ],
          }),
        },
      ],
      metadata: {
        stage: "viral_content_generation",
        outputType,
        platform,
      },
    });

    const parsed = parseViralPayload(output.content);
    if (!parsed) {
      return { payload: fallback, aiUsed: false };
    }
    const result: {
      payload: ViralPayload;
      aiUsed: boolean;
      routeReason?: string;
      model?: string;
      provider?: string;
    } = {
      payload: parsed,
      aiUsed: true,
      model: output.model,
      provider: output.provider,
    };
    if (typeof output.raw.reasoning === "string") {
      result.routeReason = output.raw.reasoning;
    }
    return result;
  } catch {
    return { payload: fallback, aiUsed: false };
  }
}

export async function generateContentFromLesson(
  outputType: CreateContentOutputInput["outputType"],
  lesson: LessonSource,
  options?: GenerateContentOptions,
): Promise<GeneratedContentOutput> {
  const normalizedLesson: LessonSource = {
    lessonTitle: normalizeText(lesson.lessonTitle),
    lessonSummary: normalizeText(lesson.lessonSummary),
    lessonBody: normalizeText(lesson.lessonBody),
  };
  const platform = mapOutputToPlatform(outputType);
  const planTier = resolvePlanTier(options?.planTier);

  const deterministic = buildDeterministicViralPayload(platform, normalizedLesson, options?.shareCount);
  const aiResult = await tryAiEnhancePayload(outputType, normalizedLesson, deterministic, planTier);
  const payload = aiResult.payload;
  const dynamic = computeDynamicViralityScore({
    hook: payload.hook,
    script: payload.script,
    emotionalTriggers: payload.emotionalTriggers,
    ...(options?.shareCount !== undefined ? { shareCount: options.shareCount } : {}),
  });

  return {
    title: `${platform}: ${normalizedLesson.lessonTitle}`,
    content: renderPayloadToContent(payload),
    metaJson: {
      outputType,
      platform,
      hook: payload.hook,
      script: payload.script,
      cta: payload.cta,
      viralityScore: dynamic.viralityScore,
      breakdown: dynamic.breakdown,
      emotionalTriggers: payload.emotionalTriggers,
      aiUsed: aiResult.aiUsed,
      ...(aiResult.routeReason ? { routeReason: aiResult.routeReason } : {}),
      ...(aiResult.model ? { model: aiResult.model } : {}),
      ...(aiResult.provider ? { provider: aiResult.provider } : {}),
      planTier,
    },
  };
}
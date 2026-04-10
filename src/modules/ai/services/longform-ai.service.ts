import { getModelRoute, runAiTask } from "../router/model-router.service";
import { classifyTaskType } from "../router/task-classifier";
import type { PlanTier } from "../providers/ai-provider.types";
import {
  longformVideoOutputSchema,
  type LongformScene,
  type LongformVideoResult,
} from "../schemas/longform-output.schema";

export type GenerateLongformVideoInput = {
  topic: string;
  curiosityPrompt: string;
  lessonTitle: string;
  lessonSummary: string;
  lessonBody: string;
  difficulty: string;
  tone: string;
  language: string;
  durationMinutes: number;
  planTier: PlanTier;
  userId?: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clampDurationMinutes(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(30, Math.round(n)));
}

function parseAiJson(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function sceneCountForMode(durationMinutes: number, mode: "lite" | "full"): number {
  const d = clampDurationMinutes(durationMinutes);
  if (mode === "lite") {
    return Math.min(4, Math.max(2, Math.ceil(d / 10)));
  }
  return Math.min(24, Math.max(2, Math.round(d * 0.8)));
}

function buildDeterministicLongform(
  input: GenerateLongformVideoInput,
  mode: "lite" | "full",
): LongformVideoResult {
  const durationMinutes = clampDurationMinutes(input.durationMinutes);
  const totalSeconds = durationMinutes * 60;
  const n = sceneCountForMode(durationMinutes, mode);
  const baseSeconds = Math.max(15, Math.floor(totalSeconds / n));

  const topic = normalizeText(input.topic);
  const title = normalizeText(input.lessonTitle) || `${topic}: Academic deep dive`;
  const audience =
    input.difficulty.toLowerCase().includes("advanced")
      ? "Graduate-level learners and serious practitioners"
      : input.difficulty.toLowerCase().includes("intermediate")
        ? "Undergraduate learners and motivated autodidacts"
        : "Curious beginners and lifelong learners";

  const sceneTemplates: Array<Pick<LongformScene, "goal" | "visualDirection" | "transitionNote">> = [
    {
      goal: "Frame the question and why it matters academically.",
      visualDirection: "Title card, topic keyword overlay, slow zoom on a clean diagram placeholder.",
      transitionNote: "Crossfade to problem statement.",
    },
    {
      goal: "Define core terms and assumptions.",
      visualDirection: "Split screen: definition list + simple schematic.",
      transitionNote: "Match cut to example setup.",
    },
    {
      goal: "Walk through mechanism or reasoning chain step-by-step.",
      visualDirection: "Stepwise animation; highlight each inference on screen.",
      transitionNote: "Push transition to worked example.",
    },
    {
      goal: "Contrast common misconception vs correct model.",
      visualDirection: "Two-column comparison table with bold corrections.",
      transitionNote: "Wipe to limitations and boundary conditions.",
    },
    {
      goal: "Discuss edge cases, constraints, and evidence.",
      visualDirection: "Citation-style lower thirds; highlight caveats in amber.",
      transitionNote: "Fade to synthesis.",
    },
    {
      goal: "Synthesize takeaways and map to practice.",
      visualDirection: "Summary bullets + roadmap graphic.",
      transitionNote: "End board with CTA.",
    },
  ];

  const structure: LongformScene[] = [];
  for (let i = 0; i < n; i += 1) {
    const tpl = sceneTemplates[i % sceneTemplates.length]!;
    const sceneNumber = i + 1;
    const durationSeconds =
      i === n - 1 ? Math.max(15, totalSeconds - baseSeconds * (n - 1)) : baseSeconds;

    const narration =
      mode === "lite"
        ? `[Outline] Scene ${sceneNumber}: summarize how "${title}" connects to: ${normalizeText(input.curiosityPrompt).slice(0, 120)}…`
        : `In this segment we develop the ideas behind "${title}" with emphasis on ${topic}. ` +
          `We connect the curiosity prompt (${normalizeText(input.curiosityPrompt).slice(0, 160)}) ` +
          `to the lesson’s core claims, using clear definitions and at least one concrete implication. ` +
          `Tone: ${normalizeText(input.tone)}; difficulty: ${normalizeText(input.difficulty)}.`;

    const onScreenText =
      mode === "lite"
        ? `Scene ${sceneNumber} · ${title.slice(0, 40)}…`
        : `Key idea ${sceneNumber}/${n} · ${topic}`;

    structure.push({
      sceneNumber,
      sceneTitle:
        mode === "lite"
          ? `Beat ${sceneNumber} (outline)`
          : `Scene ${sceneNumber}: ${tpl.goal.split(".")[0]}`,
      durationSeconds,
      goal: tpl.goal,
      narration,
      visualDirection: tpl.visualDirection,
      onScreenText,
      transitionNote: tpl.transitionNote,
    });
  }

  const closingSummary =
    mode === "lite"
      ? `Lite outline only (${durationMinutes} min target). Upgrade to Pro or Premium for a full scene-by-scene academic script with expanded narration and visuals.`
      : `This script sequences ${n} instructional beats across ${durationMinutes} minutes, prioritizing clarity, evidence, and transferable understanding for ${audience}.`;

  const cta =
    mode === "lite"
      ? "Upgrade to Pro or Premium in EduSpawn to unlock full long-form academic scripts."
      : "Subscribe for the worksheet, references, and chapter markers for this lesson.";

  return {
    title,
    targetAudience: audience,
    durationMinutes,
    tone: normalizeText(input.tone),
    structure,
    closingSummary,
    cta,
    qualityMeta: {
      provider: "eduSpawn",
      model: mode === "lite" ? "lite-outline-v1" : "deterministic-longform-v1",
      routeReason:
        mode === "lite"
          ? "Free tier: long-form output is restricted to a short academic outline (not a full scene script)."
          : "Deterministic fallback used (AI unavailable or parse failed).",
    },
  };
}

function buildSystemPromptFull(): string {
  return `
You are an academic educational video scriptwriter for YouTube-style long-form lessons.

Return ONLY valid JSON matching this shape:
{
  "title": "string",
  "targetAudience": "string",
  "durationMinutes": number,
  "tone": "string",
  "structure": [
    {
      "sceneNumber": number,
      "sceneTitle": "string",
      "durationSeconds": number,
      "goal": "string",
      "narration": "string",
      "visualDirection": "string",
      "onScreenText": "string",
      "transitionNote": "string"
    }
  ],
  "closingSummary": "string",
  "cta": "string"
}

Rules:
- Scene-by-scene structure suitable for 1–30 minute videos.
- Sum of structure[].durationSeconds should approximately equal durationMinutes * 60 (±10%).
- Academic tone: precise, well-paced, citation-friendly language.
- Stronger structure than short-form: explicit goals, visuals, on-screen text, transitions.
- Narration should be speakable and segmented per scene.
`.trim();
}

function buildUserPrompt(input: GenerateLongformVideoInput): string {
  const dm = clampDurationMinutes(input.durationMinutes);
  return `
Create a long-form educational video script.

Topic: ${input.topic}
Curiosity prompt: ${input.curiosityPrompt}
Lesson title: ${input.lessonTitle}
Lesson summary: ${input.lessonSummary}
Lesson body:
${input.lessonBody}

Difficulty: ${input.difficulty}
Tone: ${input.tone}
Language: ${input.language}
Target runtime: ${dm} minutes

Produce dense, academic, scene-level direction suitable for premium learning products.
`.trim();
}

export async function generateLongformVideoWithAI(
  input: GenerateLongformVideoInput,
): Promise<LongformVideoResult> {
  const planTier = input.planTier;

  if (planTier === "free") {
    return buildDeterministicLongform(input, "lite");
  }

  const taskType = classifyTaskType({ explicitTaskType: "long_video_script" });
  const route = getModelRoute(taskType, planTier);

  try {
    const output = await runAiTask({
      taskType,
      planTier,
      responseFormat: "json",
      messages: [
        { role: "system", content: buildSystemPromptFull() },
        { role: "user", content: buildUserPrompt(input) },
      ],
      metadata: {
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        stage: "longform_video",
        durationMinutes: clampDurationMinutes(input.durationMinutes),
        language: input.language,
        difficulty: input.difficulty,
        tone: input.tone,
      },
    });

    const parsed = parseAiJson(output.content);
    if (!parsed) {
      const fb = buildDeterministicLongform(input, "full");
      return {
        ...fb,
        qualityMeta: {
          provider: "eduSpawn",
          model: "deterministic-longform-v1",
          routeReason: `${route.reasoning} (empty AI response; deterministic fallback).`,
        },
      };
    }

    const candidate = {
      title: parsed.title,
      targetAudience: parsed.targetAudience,
      durationMinutes: parsed.durationMinutes,
      tone: parsed.tone,
      structure: parsed.structure,
      closingSummary: parsed.closingSummary,
      cta: parsed.cta,
    };

    const validated = longformVideoOutputSchema.safeParse(candidate);
    if (!validated.success) {
      const fallback = buildDeterministicLongform(input, "full");
      return {
        ...fallback,
        qualityMeta: {
          provider: "eduSpawn",
          model: "deterministic-longform-v1",
          routeReason: `${route.reasoning} (schema validation failed; deterministic fallback).`,
        },
      };
    }

    const dm = clampDurationMinutes(input.durationMinutes);
    return {
      ...validated.data,
      durationMinutes: dm,
      qualityMeta: {
        provider: output.provider,
        model: output.model,
        routeReason: route.reasoning,
      },
    };
  } catch {
    const fallback = buildDeterministicLongform(input, "full");
    return {
      ...fallback,
      qualityMeta: {
        ...fallback.qualityMeta,
        routeReason: `${fallback.qualityMeta.routeReason} (AI call failed).`,
      },
    };
  }
}

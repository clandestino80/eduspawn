import { normalizeJsonModeContent } from "../../ai/providers/provider-shared";
import { runAiTask } from "../../ai/router/model-router.service";
import type { PlanTier } from "../../ai/providers/ai-provider.types";
import type { CreatorPackKind } from "@prisma/client";
import type { CreatorGenerationRequest } from "../schemas/creator-request.schema";
import { longCreatorPackSchema, type LongCreatorPack } from "../schemas/creator-output-long.schema";
import { shortCreatorPackSchema, type ShortCreatorPack } from "../schemas/creator-output-short.schema";

export type CreatorAiMeta = {
  provider: string;
  model: string;
  routeReason: string;
  taskType: string;
  planTier: PlanTier;
};

function extractJsonObject(content: unknown): unknown {
  if (content !== null && typeof content === "object" && !Array.isArray(content)) {
    return content;
  }
  if (typeof content === "string") {
    return normalizeJsonModeContent(content);
  }
  return null;
}

function buildFallbackShortPack(req: CreatorGenerationRequest): ShortCreatorPack {
  const t = req.topic.trim().slice(0, 120);
  const c = req.curiosityPrompt.trim().slice(0, 400);
  return {
    title: `${t} — quick take`,
    hook: `The one idea about ${t} people scroll for.`,
    shortIntro: c,
    shortScript: `0–${Math.min(req.durationSec, 90)}s: Open with the hook, explain one insight from your curiosity, end with a single question to the viewer.`,
    titleSequenceText: `TITLE: ${t}\nSUB: ${req.audience}`,
    voiceoverText: `Hey — quick one on ${t}. ${c} Here's the takeaway in plain words. If this clicks, save it for later.`,
    visualCue: `B-roll: abstract metaphors for ${t}; on-screen keywords matching your ${req.targetPlatform} format; keep pace snappy.`,
  };
}

function buildFallbackLongPack(req: CreatorGenerationRequest): LongCreatorPack {
  const t = req.topic.trim().slice(0, 120);
  const c = req.curiosityPrompt.trim().slice(0, 600);
  const scenes = [
    { sceneNumber: 1, beat: "Cold open + promise of payoff" },
    { sceneNumber: 2, beat: "Define the idea in plain language" },
    { sceneNumber: 3, beat: "Example or analogy tied to audience" },
    { sceneNumber: 4, beat: "Contrast common misconception" },
    { sceneNumber: 5, beat: "Recap + soft CTA" },
  ];
  return {
    projectTitle: `${t} — creator pack`,
    positioningLine: `A structured ${req.targetPlatform} narrative for ${req.audience}.`,
    titleSequencePack: `MAIN TITLE: ${t}\nEPISODE LINE: ${c.slice(0, 120)}`,
    hookVariants: [
      `You’ve been curious about ${t} — here’s the version that actually sticks.`,
      `Stop scrolling: ${t} in one coherent thread.`,
    ],
    masterSynopsis: c,
    sceneOutline: scenes.map((s) => ({ sceneNumber: s.sceneNumber, beat: s.beat })),
    sceneNarration: scenes.map(
      (_, i) =>
        `Scene ${i + 1}: Speak directly to ${req.audience}; keep sentences short; tie back to "${t}".`,
    ),
    voiceoverScript: scenes
      .map((s) => `--- Scene ${s.sceneNumber} ---\n(${s.beat})\n`)
      .join("\n"),
    visualPromptPack: `Consistent color grade; simple chapter cards; b-roll that mirrors metaphors in narration; platform-safe framing for ${req.targetPlatform}.`,
    musicMood: "Light, modern, non-distracting bed; swell slightly before final CTA.",
    endingCTA: req.ctaStyle
      ? `Close with this CTA style: ${req.ctaStyle}`
      : "Invite a comment or follow — one clear action only.",
    productionNotes: `Target ~${req.durationSec}s total; language ${req.language}; tone ${req.tone}.${req.endingStyle ? ` Ending: ${req.endingStyle}` : ""}`,
  };
}

function buildUserPrompt(req: CreatorGenerationRequest, packKind: CreatorPackKind, durationBand: string): string {
  const base = [
    `Topic: ${req.topic}`,
    `Curiosity: ${req.curiosityPrompt}`,
    `Goal: ${req.goal}`,
    `Duration: ${req.durationSec} seconds (band ${durationBand})`,
    `Platform: ${req.targetPlatform}`,
    `Audience: ${req.audience}`,
    `Tone: ${req.tone}`,
    `Language: ${req.language}`,
    req.presetKey ? `Preset: ${req.presetKey}` : null,
    req.ctaStyle ? `CTA style: ${req.ctaStyle}` : null,
    req.endingStyle ? `Ending style: ${req.endingStyle}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (packKind === "SHORT_FORM") {
    return `${base}\n\nReturn ONE JSON object with exactly these string fields (no markdown fences): title, hook, shortIntro, shortScript, titleSequenceText, voiceoverText, visualCue.\nAll copy must fit the duration band and platform norms.`;
  }

  return `${base}\n\nReturn ONE JSON object (no markdown fences) with:\n- projectTitle, positioningLine, titleSequencePack (string)\n- hookVariants (string array, 2–6 items)\n- masterSynopsis (string)\n- sceneOutline: array of { sceneNumber (int), beat (string) }\n- sceneNarration: array of strings, SAME length as sceneOutline\n- voiceoverScript, visualPromptPack, musicMood, endingCTA, productionNotes (strings)\nKeep scene count reasonable for the target duration.`;
}

/**
 * Provider-agnostic creator pack generation (structured JSON). On parse failure, returns a deterministic fallback pack (never empty).
 */
export async function generateCreatorPackWithAi(args: {
  userId: string;
  planTier: PlanTier;
  packKind: CreatorPackKind;
  request: CreatorGenerationRequest;
  durationBand: string;
}): Promise<{ pack: ShortCreatorPack | LongCreatorPack; aiMeta: CreatorAiMeta; usedFallback: boolean }> {
  const taskType = args.packKind === "SHORT_FORM" ? "creator_pack_short" : "creator_pack_long";
  const system =
    "You are EduSpawn's creator strategist. Output must be educational and platform-safe — no impersonation of real people or brands as endorsers. Use abstract creative direction only.";

  const user = buildUserPrompt(args.request, args.packKind, args.durationBand);

  let usedFallback = false;
  try {
    const out = await runAiTask({
      taskType,
      planTier: args.planTier,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const raw = extractJsonObject(out.content);
    if (args.packKind === "SHORT_FORM") {
      const parsed = shortCreatorPackSchema.safeParse(raw);
      if (parsed.success) {
        return {
          pack: parsed.data,
          usedFallback: false,
          aiMeta: {
            provider: out.provider,
            model: out.model,
            routeReason: taskType,
            taskType,
            planTier: args.planTier,
          },
        };
      }
    } else {
      const parsed = longCreatorPackSchema.safeParse(raw);
      if (parsed.success) {
        return {
          pack: parsed.data,
          usedFallback: false,
          aiMeta: {
            provider: out.provider,
            model: out.model,
            routeReason: taskType,
            taskType,
            planTier: args.planTier,
          },
        };
      }
    }
  } catch (err) {
    console.error("[creator_ai_task_failed]", { userId: args.userId, taskType, err });
  }

  usedFallback = true;
  const pack =
    args.packKind === "SHORT_FORM"
      ? buildFallbackShortPack(args.request)
      : buildFallbackLongPack(args.request);

  return {
    pack,
    usedFallback,
    aiMeta: {
      provider: "fallback",
      model: "deterministic_template_v1",
      routeReason: "schema_or_provider_failure",
      taskType,
      planTier: args.planTier,
    },
  };
}

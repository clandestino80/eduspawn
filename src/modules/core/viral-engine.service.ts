import type { PlanTier } from "../ai/providers/ai-provider.types";

export type ViralPlatform =
  | "tiktok_script"
  | "instagram_reel"
  | "youtube_short"
  | "carousel_post";

export type ViralPayload = {
  hook: string;
  script: string;
  cta: string;
  viralityScore: number;
  emotionalTriggers: string[];
  breakdown: {
    hook: number;
    curiosity: number;
    emotion: number;
    shareBoost: number;
  };
};

type LessonSource = {
  lessonTitle: string;
  lessonSummary: string;
  lessonBody: string;
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function deterministicSeed(...parts: string[]): number {
  const joined = parts.join("|");
  let hash = 0;
  for (let i = 0; i < joined.length; i += 1) {
    hash = (hash * 31 + joined.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pick<T>(arr: T[], seed: number, offset = 0): T {
  return arr[(seed + offset) % arr.length] as T;
}

function clampTo10(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n)));
}

function scoreHookStrength(hook: string): number {
  const h = normalizeText(hook).toLowerCase();
  let score = 4;
  if (h.length >= 40) score += 2;
  if (h.includes("?")) score += 1;
  if (h.includes("stop") || h.includes("dikkat") || h.includes("2 saniye")) score += 1;
  if (h.includes("kimse") || h.includes("yanlis") || h.includes("asla")) score += 1;
  return clampTo10(score);
}

function scoreCuriosityGap(text: string): number {
  const t = normalizeText(text).toLowerCase();
  let score = 4;
  if (t.includes("ama") || t.includes("fakat") || t.includes("asl")) score += 2;
  if (t.includes("kimse") || t.includes("cogu")) score += 2;
  if (t.includes("neden") || t.includes("ne olur")) score += 1;
  return clampTo10(score);
}

function scoreEmotion(triggers: string[]): number {
  const uniqueCount = new Set(triggers.map((t) => normalizeText(t).toLowerCase())).size;
  return clampTo10(3 + uniqueCount * 2.5);
}

function scoreShareBoost(shareCount: number): number {
  if (shareCount <= 0) return 0;
  // Log-scale: quick early gains, saturates near 10.
  const scaled = Math.log10(shareCount + 1) * 5;
  return clampTo10(scaled);
}

export function computeDynamicViralityScore(input: {
  hook: string;
  script: string;
  emotionalTriggers: string[];
  shareCount?: number;
}): {
  viralityScore: number;
  breakdown: {
    hook: number;
    curiosity: number;
    emotion: number;
    shareBoost: number;
  };
} {
  const hook = scoreHookStrength(input.hook);
  const curiosity = scoreCuriosityGap(input.hook + " " + input.script);
  const emotion = scoreEmotion(input.emotionalTriggers);
  const shareBoost = scoreShareBoost(input.shareCount ?? 0);

  // Base 30 + weighted components (max 70) => total 100
  const viralityScore = Math.max(
    0,
    Math.min(100, Math.round(30 + hook * 2 + curiosity * 2 + emotion * 2 + shareBoost)),
  );

  return {
    viralityScore,
    breakdown: { hook, curiosity, emotion, shareBoost },
  };
}

export function buildDeterministicViralPayload(
  platform: ViralPlatform,
  lesson: LessonSource,
  shareCount?: number,
): ViralPayload {
  const seed = deterministicSeed(platform, lesson.lessonTitle, lesson.lessonSummary);
  const summary = truncate(lesson.lessonSummary, 160);
  const body = truncate(lesson.lessonBody, platform === "carousel_post" ? 420 : 280);

  const emotionalTriggers = [
    pick(["surprise", "status", "urgency", "relief"], seed, 1),
    pick(["curiosity", "identity", "achievement", "fear_of_missing_out"], seed, 2),
  ];

  const hookTemplates = [
    `Stop scrolling: ${lesson.lessonTitle} sandigindan farkli calisiyor.`,
    `Bunu bilenler 10x hizli ogreniyor: ${lesson.lessonTitle}`,
    `${lesson.lessonTitle} hakkinda kimsenin anlatmadigi kisim:`,
    `2 saniyede test: ${lesson.lessonTitle} gercekten anladin mi?`,
  ];

  const curiosityGap = pick(
    [
      "Asil kritik nokta genelde en sonda anlasilir.",
      "Cogu kisi ayni yerde hata yapiyor.",
      "Kucuk bir fark tum sonucu degistiriyor.",
      "Bir edge-case tum resmi tersine cevirebiliyor.",
    ],
    seed,
    3,
  );

  const cta = pick(
    [
      "Bunu zorlanan birine gonder.",
      "Kaydet, 24 saat sonra kendini test et.",
      "Yorumda tek cumleyle ne ogrendigini yaz.",
      "Bunu ekip arkadasinla paylas ve birlikte quiz yap.",
    ],
    seed,
    4,
  );

  const baseHook = pick(hookTemplates, seed, 0);
  const hook = `${baseHook} ${curiosityGap}`;

  let script = "";
  if (platform === "carousel_post") {
    script = [
      `Slide 1: ${hook}`,
      `Slide 2: ${summary}`,
      `Slide 3: ${truncate(body.slice(0, 140), 140)}`,
      `Slide 4: ${truncate(body.slice(140, 280), 140)}`,
      `Slide 5: ${truncate(body.slice(280), 140)}`,
      `Slide 6: ${cta}`,
    ].join("\n");
  } else {
    const styleLine =
      platform === "tiktok_script"
        ? "TikTok pacing: hizli kesit, tek fikir, net payoff."
        : platform === "instagram_reel"
          ? "Reel pacing: ritmik anlatim + net mesaj."
          : "YouTube Short pacing: mini ders + retention hook.";
    script = [
      `HOOK (0-2s): ${hook}`,
      `SETUP (2-8s): ${summary}`,
      `CORE (8-28s): ${body}`,
      `PAYOFF (28-35s): Tek cikarim: ${lesson.lessonTitle} uygulamada fark yaratir.`,
      `STYLE: ${styleLine}`,
      `CTA: ${cta}`,
    ].join("\n\n");
  }

  const dynamic = computeDynamicViralityScore({
    hook,
    script,
    emotionalTriggers,
    ...(shareCount !== undefined ? { shareCount } : {}),
  });

  return {
    hook,
    script,
    cta,
    viralityScore: dynamic.viralityScore,
    emotionalTriggers,
    breakdown: dynamic.breakdown,
  };
}

export function mapOutputToPlatform(outputType: string): ViralPlatform {
  if (outputType === "tiktok_script" || outputType === "short_video_script") return "tiktok_script";
  if (outputType === "instagram_reel") return "instagram_reel";
  if (outputType === "youtube_short") return "youtube_short";
  if (outputType === "carousel_post") return "carousel_post";
  return "tiktok_script";
}

export function resolveContentTaskType(platform: ViralPlatform): "short_video_script" | "carousel_post" {
  if (platform === "carousel_post") return "carousel_post";
  return "short_video_script";
}

export function resolvePlanTier(userPlan?: PlanTier): PlanTier {
  return userPlan ?? "free";
}

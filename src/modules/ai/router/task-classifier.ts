import type { AiTaskType } from "../providers/ai-provider.types";

type TaskKeywordConfig = {
  task: AiTaskType;
  keywords: string[];
};

const TASK_KEYWORDS: TaskKeywordConfig[] = [
  {
    task: "lesson_generation",
    keywords: [
      "lesson",
      "teach",
      "explain",
      "learn",
      "learning",
      "study",
      "educational",
      "concept",
      "understand",
      "guide",
      "tutorial",
      "ders",
      "öğret",
      "anlat",
      "öğren",
      "öğrenme",
      "eğitim",
      "konu anlatımı",
      "özet çıkar",
      "açıkla",
      "mantığını anlat",
    ],
  },
  {
    task: "quiz_generation",
    keywords: [
      "quiz",
      "questions",
      "mcq",
      "multiple choice",
      "test",
      "assessment",
      "practice questions",
      "exam",
      "soru",
      "quiz hazırla",
      "çoktan seçmeli",
      "test hazırla",
      "değerlendirme",
      "sınav",
      "pratik soru",
    ],
  },
  {
    task: "short_video_script",
    keywords: [
      "short video",
      "short-form",
      "reel",
      "reels",
      "tiktok",
      "shorts",
      "viral video",
      "hook",
      "30 second",
      "60 second",
      "60s",
      "15s",
      "kısa video",
      "viral video",
      "reels metni",
      "kısa senaryo",
      "hook yaz",
      "30 saniye",
      "60 saniye",
      "dikey video",
    ],
  },
  {
    task: "carousel_post",
    keywords: [
      "carousel",
      "slides",
      "instagram carousel",
      "slide post",
      "swipe post",
      "linkedin carousel",
      "karusel",
      "carousel post",
      "slayt post",
      "instagram post",
      "slide slide anlat",
      "kaydırmalı post",
    ],
  },
  {
    task: "narration",
    keywords: [
      "narration",
      "voiceover",
      "voice over",
      "audio script",
      "spoken script",
      "podcast style",
      "seslendirme",
      "anlatıcı metni",
      "voiceover metni",
      "sesli anlatım",
      "okuma metni",
      "anlatım metni",
    ],
  },
  {
    task: "image_prompt",
    keywords: [
      "image prompt",
      "visual prompt",
      "illustration",
      "poster prompt",
      "thumbnail prompt",
      "text to image",
      "image generation",
      "görsel prompt",
      "illüstrasyon",
      "afiş prompt",
      "thumbnail",
      "görsel üret",
      "resim promptu",
    ],
  },
  {
    task: "long_video_script",
    keywords: [
      "long video",
      "long-form",
      "youtube video",
      "youtube script",
      "documentary script",
      "scene by scene",
      "scene-by-scene",
      "1 minute",
      "5 minute",
      "10 minute",
      "20 minute",
      "30 minute",
      "academic video",
      "deep dive",
      "detailed script",
      "uzun video",
      "uzun form",
      "youtube senaryosu",
      "sahne sahne",
      "scene scene",
      "1 dakikalık",
      "5 dakikalık",
      "10 dakikalık",
      "20 dakikalık",
      "30 dakikalık",
      "akademik video",
      "detaylı anlatım",
      "uzun anlatım",
      "belgesel tarzı",
    ],
  },
  {
    task: "critic_review",
    keywords: [
      "review",
      "critique",
      "critic",
      "evaluate",
      "improve",
      "rewrite",
      "feedback",
      "quality check",
      "score this",
      "review this script",
      "değerlendir",
      "eleştir",
      "geliştir",
      "yeniden yaz",
      "geri bildirim",
      "kalite kontrol",
      "puanla",
      "incele",
    ],
  },
];

export type TaskClassifierInput = {
  explicitTaskType?: AiTaskType;
  text?: string;
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreTask(text: string, keywords: string[]): number {
  let score = 0;

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);

    if (!normalizedKeyword) continue;

    if (text.includes(normalizedKeyword)) {
      score += normalizedKeyword.includes(" ") ? 3 : 1;
    }
  }

  return score;
}

export function classifyTaskType(input: TaskClassifierInput): AiTaskType {
  if (input.explicitTaskType) {
    return input.explicitTaskType;
  }

  const text = normalizeText(input.text ?? "");

  if (!text) {
    return "lesson_generation";
  }

  let bestTask: AiTaskType = "lesson_generation";
  let bestScore = 0;

  for (const item of TASK_KEYWORDS) {
    const score = scoreTask(text, item.keywords);

    if (score > bestScore) {
      bestScore = score;
      bestTask = item.task;
    }
  }

  return bestTask;
}
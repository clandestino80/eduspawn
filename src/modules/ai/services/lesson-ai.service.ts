import { getModelRoute, runAiTask } from "../router/model-router.service";
import { classifyTaskType } from "../router/task-classifier";
import type { PlanTier } from "../providers/ai-provider.types";

type GenerateLessonWithAiInput = {
  userId: string;
  topic: string;
  curiosityPrompt: string;
  difficulty?: string;
  tone?: string;
  language?: string;
  planTier?: PlanTier;
};

type LessonQuizQuestion = {
  type: "mcq";
  question: string;
  options: string[];
  answer: string;
};

type LessonAiResult = {
  lessonTitle: string;
  lessonSummary: string;
  lessonBody: string;
  wowFacts: string[];
  quizQuestions: LessonQuizQuestion[];
  aiMeta: {
    provider: string;
    model: string;
    routeReason: string;
    taskType: string;
    planTier: PlanTier;
  };
};

type LessonCriticFeedback = {
  clarityIssues: string[];
  missingDepth: string[];
  engagementLevel: "low" | "medium" | "high";
  improvementSuggestions: string[];
};

type LessonQualityMeta = {
  draftModel: string;
  criticModel: string | null;
  refineModel: string | null;
  qualityScore: number;
  improvementsApplied: string[];
};

type LessonQualityPipelineResult = {
  lessonTitle: string;
  lessonSummary: string;
  lessonBody: string;
  wowFacts: string[];
  quizQuestions: LessonQuizQuestion[];
  qualityMeta: LessonQualityMeta;
  aiMeta: LessonAiResult["aiMeta"];
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  return fallback;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function safeQuizQuestions(value: unknown): LessonQuizQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;

      const question = safeString(record.question);
      const answer = safeString(record.answer);
      const options = safeStringArray(record.options);

      if (!question || !answer || options.length === 0) {
        return null;
      }

      return {
        type: "mcq" as const,
        question,
        options,
        answer,
      };
    })
    .filter((item): item is LessonQuizQuestion => item !== null);
}

function buildFallbackLesson(input: GenerateLessonWithAiInput): Omit<LessonAiResult, "aiMeta"> {
  const topic = normalizeText(input.topic);
  const curiosity = normalizeText(input.curiosityPrompt);
  const difficulty = normalizeText(input.difficulty ?? "beginner");
  const tone = normalizeText(input.tone ?? "friendly");

  return {
    lessonTitle: `${topic}: temel fikirleri anla`,
    lessonSummary: `${topic} konusunu ${tone} ve ${difficulty} seviyesinde, merak tetikleyen bir yaklaşımla açıklar.`,
    lessonBody: [
      `Başlangıç sorusu: "${curiosity}"`,
      "",
      `1. Önce ${topic} konusunun neden önemli olduğunu sade dille kur.`,
      `2. Sonra temel mekanizmayı parçalara ayır ve bağlantıları göster.`,
      `3. Ardından gerçek hayattan veya sezgisel bir örnekle anlamı güçlendir.`,
      `4. Son olarak kullanıcıdan bu fikri kendi cümleleriyle yeniden anlatmasını iste.`,
    ].join("\n"),
    wowFacts: [
      `${topic} çoğu zaman ilk bakışta göründüğünden daha sezgiseldir.`,
      `Doğru soru ile başlamak, ${topic} öğrenimini ciddi biçimde hızlandırır.`,
      `${topic} bilgisini kısa tekrar ve aktif hatırlama ile kalıcı hale getirmek daha kolaydır.`,
    ],
    quizQuestions: [
      {
        type: "mcq",
        question: `${topic} öğrenirken en güçlü başlangıç adımı nedir?`,
        options: [
          "Ezbere detay toplamak",
          "Merak sorusunu netleştirmek",
          "Sadece ileri seviye örneklere bakmak",
          "Quiz yapmadan ilerlemek",
        ],
        answer: "Merak sorusunu netleştirmek",
      },
      {
        type: "mcq",
        question: `${topic} konusunu daha iyi anlamak için hangi yaklaşım en etkilidir?`,
        options: [
          "Parçalara ayırıp ilişkileri görmek",
          "Sadece tanımları kopyalamak",
          "Örneklerden tamamen kaçınmak",
          "Konuyu tek seferde bitirmeye çalışmak",
        ],
        answer: "Parçalara ayırıp ilişkileri görmek",
      },
      {
        type: "mcq",
        question: `${topic} bilgisinin kalıcı olması için hangisi daha güçlüdür?`,
        options: [
          "Pasif tekrar",
          "Uzun ama dağınık notlar",
          "Aktif hatırlama ve kısa quiz",
          "Konuyu hiç özetlememek",
        ],
        answer: "Aktif hatırlama ve kısa quiz",
      },
    ],
  };
}

function buildSystemPrompt(): string {
  return `
You are EduSpawn Lesson AI.

Your job is to transform user curiosity into a structured, engaging learning experience.

Rules:
- Write clearly and naturally.
- Be educational, but never boring.
- Keep explanations easy to follow.
- Use a curiosity-driven, learner-friendly tone.
- Avoid dry academic phrasing unless the requested tone is academic.
- Prefer structured, polished output over rambling text.
- The response must be valid JSON only.

Return STRICT JSON with this exact shape:
{
  "lessonTitle": "string",
  "lessonSummary": "string",
  "lessonBody": "string",
  "wowFacts": ["string", "string", "string"],
  "quizQuestions": [
    {
      "type": "mcq",
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "answer": "string"
    }
  ]
}
`.trim();
}

function buildUserPrompt(input: GenerateLessonWithAiInput): string {
  return `
Create a structured learning lesson.

Topic: ${input.topic}
Curiosity Prompt: ${input.curiosityPrompt}
Difficulty: ${input.difficulty ?? "beginner"}
Tone: ${input.tone ?? "friendly"}
Language: ${input.language ?? "tr"}

Additional instructions:
- Make the lesson compelling and memorable.
- Include 3 wow facts.
- Include 3 MCQ quiz questions.
- Keep the output practical and suitable for a learning app.
- Return JSON only.
`.trim();
}

function buildDraftSystemPrompt(): string {
  return `
You are an engaging AI teacher.

Create high-quality educational lessons that are structured, clear, and motivating.
Return only valid JSON with:
{
  "lessonTitle": "string",
  "lessonSummary": "string",
  "lessonBody": "string",
  "wowFacts": ["string", "string", "string"],
  "quizQuestions": [
    {
      "type": "mcq",
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "answer": "string"
    }
  ]
}
`.trim();
}

function buildCriticSystemPrompt(): string {
  return `
You are a strict educational content reviewer.

Review the lesson draft and return only valid JSON:
{
  "clarityIssues": ["string"],
  "missingDepth": ["string"],
  "engagementLevel": "low|medium|high",
  "improvementSuggestions": ["string"]
}
`.trim();
}

function buildRefineSystemPrompt(): string {
  return `
You improve content using expert feedback.

Take draft lesson + critic feedback and produce an improved final lesson.
Return only valid JSON with:
{
  "lessonTitle": "string",
  "lessonSummary": "string",
  "lessonBody": "string",
  "wowFacts": ["string", "string", "string"],
  "quizQuestions": [
    {
      "type": "mcq",
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "answer": "string"
    }
  ]
}
`.trim();
}

function parseAiContent(rawContent: unknown): Record<string, unknown> | null {
  if (rawContent && typeof rawContent === "object" && !Array.isArray(rawContent)) {
    return rawContent as Record<string, unknown>;
  }

  if (typeof rawContent === "string") {
    try {
      const parsed = JSON.parse(rawContent) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function parseCriticFeedback(rawContent: unknown): LessonCriticFeedback | null {
  const parsed = parseAiContent(rawContent);
  if (!parsed) return null;

  const clarityIssues = safeStringArray(parsed.clarityIssues);
  const missingDepth = safeStringArray(parsed.missingDepth);
  const improvementSuggestions = safeStringArray(parsed.improvementSuggestions);
  const engagementRaw = safeString(parsed.engagementLevel, "medium").toLowerCase();
  const engagementLevel: LessonCriticFeedback["engagementLevel"] =
    engagementRaw === "low" || engagementRaw === "high" ? engagementRaw : "medium";

  return {
    clarityIssues,
    missingDepth,
    engagementLevel,
    improvementSuggestions,
  };
}

function materializeLesson(parsed: Record<string, unknown> | null, fallback: Omit<LessonAiResult, "aiMeta">) {
  const lessonTitle = safeString(parsed?.lessonTitle, fallback.lessonTitle);
  const lessonSummary = safeString(parsed?.lessonSummary, fallback.lessonSummary);
  const lessonBody = safeString(parsed?.lessonBody, fallback.lessonBody);
  const wowFacts = safeStringArray(parsed?.wowFacts);
  const quizQuestions = safeQuizQuestions(parsed?.quizQuestions);

  return {
    lessonTitle,
    lessonSummary,
    lessonBody,
    wowFacts: wowFacts.length > 0 ? wowFacts : fallback.wowFacts,
    quizQuestions: quizQuestions.length > 0 ? quizQuestions : fallback.quizQuestions,
  };
}

function computeQualityScore(input: {
  base: number;
  suggestionsApplied: number;
  engagement: LessonCriticFeedback["engagementLevel"];
}): number {
  const engagementBoost = input.engagement === "high" ? 8 : input.engagement === "medium" ? 4 : 0;
  const score = input.base + Math.min(input.suggestionsApplied * 3, 15) + engagementBoost;
  return Math.max(0, Math.min(100, score));
}

async function runDraftStep(input: GenerateLessonWithAiInput) {
  const taskType = classifyTaskType({
    explicitTaskType: "lesson_generation",
    text: `${input.topic} ${input.curiosityPrompt}`,
  });
  const planTier = input.planTier ?? "free";
  const route = getModelRoute(taskType, planTier);
  const output = await runAiTask({
    taskType,
    planTier,
    responseFormat: "json",
    messages: [
      { role: "system", content: buildDraftSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ],
    metadata: {
      userId: input.userId,
      topic: input.topic,
      curiosityPrompt: input.curiosityPrompt,
      difficulty: input.difficulty ?? "beginner",
      tone: input.tone ?? "friendly",
      language: input.language ?? "tr",
      stage: "draft",
    },
  });

  return { taskType, route, output };
}

export async function generateLessonWithQualityPipeline(
  input: GenerateLessonWithAiInput,
): Promise<LessonQualityPipelineResult> {
  const planTier = input.planTier ?? "free";
  const fallback = buildFallbackLesson(input);
  const draft = await runDraftStep(input);
  const draftLesson = materializeLesson(parseAiContent(draft.output.content), fallback);

  if (planTier === "free") {
    return {
      ...draftLesson,
      qualityMeta: {
        draftModel: draft.route.model,
        criticModel: null,
        refineModel: null,
        qualityScore: 62,
        improvementsApplied: [],
      },
      aiMeta: {
        provider: draft.output.provider,
        model: draft.output.model,
        routeReason: draft.route.reasoning,
        taskType: draft.taskType,
        planTier,
      },
    };
  }

  try {
    const criticTaskType = classifyTaskType({ explicitTaskType: "critic_review" });
    const criticRoute = getModelRoute(criticTaskType, planTier);
    const criticOutput = await runAiTask({
      taskType: criticTaskType,
      planTier,
      responseFormat: "json",
      messages: [
        { role: "system", content: buildCriticSystemPrompt() },
        {
          role: "user",
          content: `Review this lesson draft and return structured critique JSON only:\n${JSON.stringify(
            draftLesson,
          )}`,
        },
      ],
      metadata: {
        userId: input.userId,
        topic: input.topic,
        stage: "critic",
      },
    });

    const critic =
      parseCriticFeedback(criticOutput.content) ??
      ({
        clarityIssues: [],
        missingDepth: [],
        engagementLevel: "medium",
        improvementSuggestions: [],
      } satisfies LessonCriticFeedback);

    const refineTaskType = classifyTaskType({ explicitTaskType: "lesson_generation" });
    const refineRoute = getModelRoute(refineTaskType, planTier);
    const refineOutput = await runAiTask({
      taskType: refineTaskType,
      planTier,
      responseFormat: "json",
      messages: [
        { role: "system", content: buildRefineSystemPrompt() },
        {
          role: "user",
          content:
            `Original draft lesson:\n${JSON.stringify(draftLesson)}\n\n` +
            `Critic feedback:\n${JSON.stringify(critic)}\n\n` +
            "Apply improvements and return final JSON lesson.",
        },
      ],
      metadata: {
        userId: input.userId,
        topic: input.topic,
        stage: "refine",
      },
    });

    const refinedLesson = materializeLesson(parseAiContent(refineOutput.content), draftLesson);
    const improvementsApplied = critic.improvementSuggestions.slice(0, 6);
    const qualityScore = computeQualityScore({
      base: planTier === "premium" ? 82 : 74,
      suggestionsApplied: improvementsApplied.length,
      engagement: critic.engagementLevel,
    });

    return {
      ...refinedLesson,
      qualityMeta: {
        draftModel: draft.route.model,
        criticModel: criticRoute.model,
        refineModel: refineRoute.model,
        qualityScore,
        improvementsApplied,
      },
      aiMeta: {
        provider: refineOutput.provider,
        model: refineOutput.model,
        routeReason: refineRoute.reasoning,
        taskType: refineTaskType,
        planTier,
      },
    };
  } catch {
    return {
      ...draftLesson,
      qualityMeta: {
        draftModel: draft.route.model,
        criticModel: null,
        refineModel: null,
        qualityScore: 68,
        improvementsApplied: [],
      },
      aiMeta: {
        provider: draft.output.provider,
        model: draft.output.model,
        routeReason: `${draft.route.reasoning} (fallback_to_draft)`,
        taskType: draft.taskType,
        planTier,
      },
    };
  }
}

// Backward compatibility for existing callers.
export async function generateLessonWithAI(
  input: GenerateLessonWithAiInput,
): Promise<LessonQualityPipelineResult> {
  return generateLessonWithQualityPipeline(input);
}
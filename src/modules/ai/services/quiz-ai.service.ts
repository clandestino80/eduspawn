import { getModelRoute, runAiTask } from "../router/model-router.service";
import { classifyTaskType } from "../router/task-classifier";
import type { PlanTier } from "../providers/ai-provider.types";
import {
  type AssessmentMeta,
  type McqQuestion,
  mcqQuestionSchema,
  quizGenerationOutputSchema,
} from "../schemas/quiz-output.schema";

export type GenerateQuizWithAiInput = {
  topic: string;
  curiosityPrompt: string;
  lessonTitle: string;
  lessonSummary: string;
  lessonBody: string;
  difficulty: string;
  tone: string;
  language: string;
  planTier: PlanTier;
  userId?: string;
};

export type GenerateQuizWithAiResult = {
  questions: McqQuestion[];
  assessmentMeta: AssessmentMeta;
};

export type DifficultyTier = "beginner" | "intermediate" | "advanced";

export type EvaluateQuizAttemptInput = {
  questions: McqQuestion[];
  answersJson: Record<string, unknown>;
  totalQuestions?: number;
};

export type EvaluateQuizAttemptResult = {
  score: number;
  correctCount: number;
  totalQuestions: number;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
  recommendedFocus: string[];
  perQuestion: Record<string, boolean>;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Maps session/UI difficulty strings to a tier so quiz cognitive level matches the learner.
 */
export function resolveDifficultyTier(raw: string): DifficultyTier {
  const s = normalizeText(raw).toLowerCase();

  if (
    s === "beginner" ||
    s === "basic" ||
    s === "easy" ||
    s === "novice" ||
    s === "intro" ||
    s === "introduction"
  ) {
    return "beginner";
  }

  if (
    s === "intermediate" ||
    s === "mid" ||
    s === "medium" ||
    s === "standard"
  ) {
    return "intermediate";
  }

  if (
    s === "advanced" ||
    s === "hard" ||
    s === "expert" ||
    s === "pro"
  ) {
    return "advanced";
  }

  return "beginner";
}

function difficultyQuizGuidance(tier: DifficultyTier): {
  focus: string;
  questionStyle: string;
  distractorStyle: string;
} {
  switch (tier) {
    case "beginner":
      return {
        focus: "basic understanding",
        questionStyle:
          "Ask about definitions, main ideas, and direct takeaways from the lesson. Learners should recognize correct ideas with minimal inference.",
        distractorStyle:
          "Use clearly weaker distractors; avoid subtle traps. Wrong options should be obviously inconsistent with the lesson.",
      };
    case "intermediate":
      return {
        focus: "concept application",
        questionStyle:
          "Ask learners to apply ideas to short scenarios, choose the best approach among plausible alternatives, or connect cause and effect.",
        distractorStyle:
          "Use plausible distractors that differ in how the concept is applied, not just vocabulary swaps.",
      };
    case "advanced":
      return {
        focus: "reasoning and edge cases",
        questionStyle:
          "Ask about tradeoffs, limitations, multi-step reasoning, boundary conditions, and common misconceptions. Include at least one question that requires weighing edge cases or exceptions.",
        distractorStyle:
          "Use sophisticated distractors that could tempt partial understanding; require careful reasoning to eliminate.",
      };
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
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

function buildQuizSystemPrompt(tier: DifficultyTier): string {
  const g = difficultyQuizGuidance(tier);
  return `
You are EduSpawn Quiz AI.

Create rigorous, fair multiple-choice questions aligned with the lesson.

Difficulty tier: ${tier} (${g.focus})
- ${g.questionStyle}
- ${g.distractorStyle}

Return ONLY valid JSON with this exact shape:
{
  "questions": [
    {
      "type": "mcq",
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "answer": "string",
      "explanation": "string"
    }
  ]
}

Rules:
- Exactly 4 options per question.
- The "answer" must match one option string exactly.
- Explanations must be concise and learner-friendly.
- Match question cognitive demand to the tier above.
`.trim();
}

function buildQuizUserPrompt(input: GenerateQuizWithAiInput, tier: DifficultyTier): string {
  const g = difficultyQuizGuidance(tier);
  return `
Generate 3 MCQ questions for this learning session.

Topic: ${input.topic}
Curiosity prompt: ${input.curiosityPrompt}
Stated difficulty: ${input.difficulty} (resolved tier: ${tier} — ${g.focus})
Tone: ${input.tone}
Language: ${input.language}

Pedagogical target for this tier:
- ${g.questionStyle}
- ${g.distractorStyle}

Lesson title: ${input.lessonTitle}
Lesson summary: ${input.lessonSummary}
Lesson body:
${input.lessonBody}
`.trim();
}

function buildPlaceholderQuiz(input: GenerateQuizWithAiInput): GenerateQuizWithAiResult {
  const t = normalizeText(input.topic);
  const tier = resolveDifficultyTier(input.difficulty);

  const beginner: McqQuestion[] = [
    {
      type: "mcq",
      question: `According to this lesson, what is the main takeaway about ${t}?`,
      options: [
        "The core idea the lesson wants you to remember",
        "A random detail with no connection to the lesson",
        "Ignoring the topic completely",
        "Only memorizing long quotes without meaning",
      ],
      answer: "The core idea the lesson wants you to remember",
      explanation: "Beginner items check basic understanding of the lesson’s main message.",
    },
    {
      type: "mcq",
      question: `Which phrase best describes what ${t} refers to in this lesson?`,
      options: [
        "The key concept explained in simple terms",
        "Something unrelated to the lesson",
        "A trick question with no answer in the text",
        "Only advanced jargon with no definition",
      ],
      answer: "The key concept explained in simple terms",
      explanation: "Recognizing the definition or label used in the lesson is basic understanding.",
    },
    {
      type: "mcq",
      question: `What does the lesson suggest you do first when exploring ${t}?`,
      options: [
        "Clarify what you are curious about",
        "Skip all examples",
        "Avoid any questions",
        "Give up if it feels unfamiliar",
      ],
      answer: "Clarify what you are curious about",
      explanation: "Basic understanding includes following the lesson’s starting move.",
    },
  ];

  const intermediate: McqQuestion[] = [
    {
      type: "mcq",
      question: `You want to use ${t} in a simple real situation. What is the best first application step?`,
      options: [
        "Map the situation to the lesson’s core mechanism, then act",
        "Ignore context and copy any definition",
        "Assume the concept never applies outside the text",
        "Avoid trying anything concrete",
      ],
      answer: "Map the situation to the lesson’s core mechanism, then act",
      explanation: "Intermediate items test applying the concept, not just naming it.",
    },
    {
      type: "mcq",
      question: `Two friends disagree about ${t}. What is a fair way to decide which approach fits?`,
      options: [
        "Compare how each option matches the lesson’s criteria and evidence",
        "Pick whichever sounds longer",
        "Choose randomly",
        "Assume both are always wrong",
      ],
      answer: "Compare how each option matches the lesson’s criteria and evidence",
      explanation: "Application means judging alternatives using lesson ideas.",
    },
    {
      type: "mcq",
      question: `Which example best shows ${t} in action?`,
      options: [
        "A short scenario where the mechanism clearly changes the outcome",
        "A scenario with no link to the lesson",
        "A scenario that contradicts the lesson on purpose",
        "A scenario with missing information and no lesson tie-in",
      ],
      answer: "A short scenario where the mechanism clearly changes the outcome",
      explanation: "Recognizing a valid application distinguishes surface reading from use.",
    },
  ];

  const advanced: McqQuestion[] = [
    {
      type: "mcq",
      question: `Where is ${t} most likely to fail or behave unexpectedly, and what should you watch for?`,
      options: [
        "Boundary cases: assumptions break, so check preconditions and limits",
        "It never fails in any situation",
        "Failure only depends on luck",
        "Edge cases are irrelevant to learning",
      ],
      answer: "Boundary cases: assumptions break, so check preconditions and limits",
      explanation: "Advanced items probe reasoning about limits and edge cases.",
    },
    {
      type: "mcq",
      question: `What tradeoff is most honest when using ${t} in complex settings?`,
      options: [
        "You may gain clarity while spending more time on validation",
        "There are never any tradeoffs",
        "Complex settings always make the concept meaningless",
        "Tradeoffs only exist for experts, never learners",
      ],
      answer: "You may gain clarity while spending more time on validation",
      explanation: "Reasoning about tradeoffs goes beyond one-step application.",
    },
    {
      type: "mcq",
      question: `A common misconception about ${t} is X. Why is X misleading?`,
      options: [
        "It oversimplifies or ignores conditions where the lesson’s model changes",
        "Misconceptions are always impossible",
        "X is always fully correct",
        "The lesson never addresses misconceptions",
      ],
      answer: "It oversimplifies or ignores conditions where the lesson’s model changes",
      explanation: "Evaluating misconceptions tests deep reasoning, not recall alone.",
    },
  ];

  const questions =
    tier === "intermediate" ? intermediate : tier === "advanced" ? advanced : beginner;

  return {
    questions,
    assessmentMeta: {
      provider: "fallback",
      model: "placeholder-quiz",
      routeReason: `AI quiz generation failed; deterministic placeholder (${tier}: ${difficultyQuizGuidance(tier).focus}).`,
      questionCount: questions.length,
    },
  };
}

function safeParseQuestions(raw: unknown): McqQuestion[] | null {
  const parsed = parseAiJson(raw);
  if (!parsed) return null;
  const inner = parsed.questions !== undefined ? parsed : { questions: parsed };
  const result = quizGenerationOutputSchema.safeParse(inner);
  if (!result.success) return null;
  return result.data.questions.map((q) => mcqQuestionSchema.parse(q));
}

export async function generateQuizWithAI(
  input: GenerateQuizWithAiInput,
): Promise<GenerateQuizWithAiResult> {
  const taskType = classifyTaskType({ explicitTaskType: "quiz_generation" });
  const planTier = input.planTier;
  const route = getModelRoute(taskType, planTier);
  const tier = resolveDifficultyTier(input.difficulty);

  try {
    const output = await runAiTask({
      taskType,
      planTier,
      responseFormat: "json",
      messages: [
        { role: "system", content: buildQuizSystemPrompt(tier) },
        { role: "user", content: buildQuizUserPrompt(input, tier) },
      ],
      metadata: {
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        topic: input.topic,
        stage: "quiz_generation",
      },
    });

    const questions = safeParseQuestions(output.content);
    if (!questions || questions.length === 0) {
      return buildPlaceholderQuiz(input);
    }

    return {
      questions,
      assessmentMeta: {
        provider: output.provider,
        model: output.model,
        routeReason: route.reasoning,
        questionCount: questions.length,
      },
    };
  } catch {
    return buildPlaceholderQuiz(input);
  }
}

function getUserAnswerForIndex(
  answersJson: Record<string, unknown>,
  index: number,
): string {
  const keys = [String(index), `q${index}`, `question_${index}`];
  for (const k of keys) {
    const v = answersJson[k];
    if (typeof v === "string") return normalizeText(v);
    if (typeof v === "number") return String(v);
  }
  return "";
}

function answersEquivalent(user: string, expected: string, options: string[]): boolean {
  const u = user.toLowerCase().trim();
  const e = expected.toLowerCase().trim();
  if (!u || !e) return false;
  if (u === e) return true;
  if (options.some((o) => o.toLowerCase().trim() === u && o.toLowerCase().trim() === e)) {
    return true;
  }
  const letters = ["a", "b", "c", "d"];
  const idx = letters.indexOf(u);
  if (idx >= 0 && options[idx] !== undefined) {
    return options[idx].toLowerCase().trim() === e;
  }
  return false;
}

function deterministicStrengthsWeaknesses(
  questions: McqQuestion[],
  wrongIndices: number[],
): { strengths: string[]; weaknesses: string[]; recommendedFocus: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendedFocus: string[] = [];
  if (wrongIndices.length === 0) {
    strengths.push("You connected ideas across the lesson consistently.");
    strengths.push("Your selections matched the intended learning outcomes.");
  } else {
    strengths.push("You attempted every question—great habit for active learning.");
  }
  for (const i of wrongIndices) {
    const q = questions[i];
    if (q) {
      weaknesses.push(`Review the concept behind: "${q.question.slice(0, 120)}…"`);
    }
  }
  if (wrongIndices.length > 0) {
    recommendedFocus.push("Re-read the lesson summary, then retry with explanation-first reasoning.");
    recommendedFocus.push("For each wrong item, explain why the correct option fits better.");
  } else {
    recommendedFocus.push("Try teaching the lesson aloud in your own words to deepen mastery.");
  }
  return { strengths, weaknesses, recommendedFocus };
}

export async function evaluateQuizAttempt(
  input: EvaluateQuizAttemptInput,
): Promise<EvaluateQuizAttemptResult> {
  const questions = input.questions;
  const totalQuestions =
    input.totalQuestions !== undefined && input.totalQuestions > 0
      ? input.totalQuestions
      : questions.length;

  if (questions.length === 0) {
    return {
      score: 0,
      correctCount: 0,
      totalQuestions: Math.max(1, totalQuestions),
      feedback: "No quiz questions were available to grade. Try regenerating the lesson quiz.",
      strengths: [],
      weaknesses: ["Quiz content missing"],
      recommendedFocus: ["Regenerate session content and submit again."],
      perQuestion: {},
    };
  }

  const perQuestion: Record<string, boolean> = {};
  let correctCount = 0;
  const wrongIndices: number[] = [];

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    if (!q) continue;
    const userAns = getUserAnswerForIndex(input.answersJson, i);
    const ok = answersEquivalent(userAns, q.answer, q.options);
    perQuestion[String(i)] = ok;
    if (ok) correctCount += 1;
    else wrongIndices.push(i);
  }

  const denom = Math.max(questions.length, 1);
  const score = Math.round((100 * correctCount) / denom);

  const { strengths, weaknesses, recommendedFocus } = deterministicStrengthsWeaknesses(
    questions,
    wrongIndices,
  );

  let feedback =
    correctCount === questions.length
      ? "Excellent work—you showed solid understanding of this lesson."
      : correctCount === 0
        ? "Keep going—use the explanations to revisit the core ideas, then try again."
        : `Nice effort—you got ${correctCount} of ${questions.length} correct. Review the missed items below.`;

  try {
    feedback = await enrichFeedbackWithAi({
      feedback,
      score,
      correctCount,
      totalQuestions: questions.length,
      wrongIndices,
      questions,
    });
  } catch {
    /* keep deterministic feedback */
  }

  return {
    score,
    correctCount,
    totalQuestions: questions.length,
    feedback,
    strengths,
    weaknesses,
    recommendedFocus,
    perQuestion,
  };
}

export function parseQuizQuestionsFromMeta(meta: unknown): McqQuestion[] | null {
  if (!meta || typeof meta !== "object") return null;
  const record = meta as Record<string, unknown>;
  const raw = record.questions;
  if (!Array.isArray(raw)) return null;
  const result = quizGenerationOutputSchema.safeParse({ questions: raw });
  if (!result.success) return null;
  return result.data.questions;
}

async function enrichFeedbackWithAi(ctx: {
  feedback: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  wrongIndices: number[];
  questions: McqQuestion[];
}): Promise<string> {
  const taskType = classifyTaskType({ explicitTaskType: "critic_review" });
  const planTier: PlanTier = "free";

  const summary = {
    score: ctx.score,
    correctCount: ctx.correctCount,
    totalQuestions: ctx.totalQuestions,
    wrongCount: ctx.wrongIndices.length,
  };

  const output = await runAiTask({
    taskType,
    planTier,
    responseFormat: "text",
    messages: [
      {
        role: "system",
        content:
          "You write short, warm, learner-friendly feedback for quiz results. Max 3 sentences. No JSON.",
      },
      {
        role: "user",
        content: `Summary: ${JSON.stringify(summary)}\nBase feedback: ${ctx.feedback}`,
      },
    ],
    metadata: { stage: "assessment_feedback" },
  });

  const text =
    typeof output.content === "string"
      ? output.content
      : JSON.stringify(output.content);
  const trimmed = normalizeText(text);
  return trimmed.length > 0 ? trimmed : ctx.feedback;
}

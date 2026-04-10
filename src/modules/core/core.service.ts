import type { Prisma, LearningSession } from "@prisma/client";
import { generateContentFromLesson } from "./content-generator.service";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import {
  generateLessonWithQualityPipeline,
} from "../ai/services/lesson-ai.service";
import {
  evaluateQuizAttempt,
  generateQuizWithAI,
  parseQuizQuestionsFromMeta,
} from "../ai/services/quiz-ai.service";
import type { PlanTier } from "../ai/providers/ai-provider.types";
import type {
  CreateContentOutputInput,
  CreateLearningSessionInput,
  CreateLongformInput,
  CreateQuizAttemptInput,
  RecordContentShareInput,
  UpsertLearningDnaInput,
} from "./core.schema";
import { generateLongformVideoWithAI } from "../ai/services/longform-ai.service";
import {
  longformVideoResultSchema,
  type LongformVideoResult,
} from "../ai/schemas/longform-output.schema";

/** Persists structured quiz without a LearningSession schema migration (see metaJson). */
const SESSION_QUIZ_OUTPUT_TYPE = "ai_generated_quiz";

const LONGFORM_OUTPUT_TYPE = "long_video_script";

function assertOwnedSession(
  userId: string,
  session: LearningSession | null,
): LearningSession {
  if (!session || session.userId !== userId) {
    throw new AppError(404, "Learning session not found", {
      code: "NOT_FOUND",
    });
  }

  return session;
}

async function getOwnedSessionOrThrow(
  userId: string,
  sessionId: string,
): Promise<LearningSession> {
  const session = await prisma.learningSession.findUnique({
    where: { id: sessionId },
  });

  return assertOwnedSession(userId, session);
}

function resolvePlanTierForUser(userId: string): PlanTier {
  const envTier = (process.env.DEFAULT_PLAN_TIER ?? "").toLowerCase();
  if (envTier === "pro" || envTier === "premium" || envTier === "free") {
    return envTier;
  }
  // Placeholder until subscription table is introduced.
  void userId;
  return "free";
}

function buildLongformReadableContent(longform: LongformVideoResult): string {
  const preview = longform.structure
    .slice(0, 3)
    .map((s) => `Scene ${s.sceneNumber}: ${s.narration}`)
    .join("\n\n");
  const more =
    longform.structure.length > 3
      ? `\n\n… (${longform.structure.length - 3} more scenes)`
      : "";
  return [longform.title, "", longform.closingSummary, "", "---", "", preview + more]
    .join("\n")
    .trim();
}

export async function upsertLearningDna(
  userId: string,
  input: UpsertLearningDnaInput,
) {
  const dnaData = {
    ...(input.preferredTone !== undefined
      ? { preferredTone: input.preferredTone }
      : {}),
    ...(input.preferredDifficulty !== undefined
      ? { preferredDifficulty: input.preferredDifficulty }
      : {}),
    ...(input.favoriteTopics !== undefined
      ? { favoriteTopics: input.favoriteTopics }
      : {}),
    ...(input.attentionSpanSeconds !== undefined
      ? { attentionSpanSeconds: input.attentionSpanSeconds }
      : {}),
    ...(input.visualPreference !== undefined
      ? { visualPreference: input.visualPreference }
      : {}),
    ...(input.quizPreference !== undefined
      ? { quizPreference: input.quizPreference }
      : {}),
    ...(input.language !== undefined ? { language: input.language } : {}),
  };

  const dna = await prisma.learningDNA.upsert({
    where: { userId },
    create: { userId, ...dnaData },
    update: dnaData,
  });

  return dna;
}

export async function getLearningDna(userId: string) {
  const dna = await prisma.learningDNA.findUnique({
    where: { userId },
  });

  if (!dna) {
    throw new AppError(404, "Learning DNA not found", {
      code: "NOT_FOUND",
    });
  }

  return dna;
}

export async function createLearningSession(
  userId: string,
  input: CreateLearningSessionInput,
) {
  const session = await prisma.learningSession.create({
    data: {
      userId,
      topic: input.topic,
      curiosityPrompt: input.curiosityPrompt,
      ...(input.difficulty !== undefined
        ? { difficulty: input.difficulty }
        : {}),
      ...(input.tone !== undefined ? { tone: input.tone } : {}),
      status: "created",
    },
  });

  return session;
}

export async function getLearningSession(userId: string, sessionId: string) {
  const session = await prisma.learningSession.findFirst({
    where: { id: sessionId, userId },
    include: {
      quizAttempts: {
        orderBy: { createdAt: "desc" },
      },
      contentOutputs: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!session) {
    throw new AppError(404, "Learning session not found", {
      code: "NOT_FOUND",
    });
  }

  return session;
}

export async function generateLessonForSession(
  userId: string,
  sessionId: string,
) {
  const session = await getOwnedSessionOrThrow(userId, sessionId);

  const learningDna = await prisma.learningDNA.findUnique({
    where: { userId },
  });

  const planTier = resolvePlanTierForUser(userId);

  const aiLesson = await generateLessonWithQualityPipeline({
    userId,
    topic: session.topic,
    curiosityPrompt: session.curiosityPrompt,
    difficulty:
      session.difficulty ??
      learningDna?.preferredDifficulty ??
      "beginner",
    tone:
      session.tone ??
      learningDna?.preferredTone ??
      "friendly",
    language: learningDna?.language ?? "tr",
    planTier,
  });

  const quizPack = await generateQuizWithAI({
    userId,
    topic: session.topic,
    curiosityPrompt: session.curiosityPrompt,
    lessonTitle: aiLesson.lessonTitle,
    lessonSummary: aiLesson.lessonSummary,
    lessonBody: aiLesson.lessonBody,
    difficulty:
      session.difficulty ??
      learningDna?.preferredDifficulty ??
      "beginner",
    tone:
      session.tone ??
      learningDna?.preferredTone ??
      "friendly",
    language: learningDna?.language ?? "tr",
    planTier,
  });

  const updated = await prisma.learningSession.update({
    where: { id: session.id },
    data: {
      lessonTitle: aiLesson.lessonTitle,
      lessonSummary: aiLesson.lessonSummary,
      lessonBody: aiLesson.lessonBody,
      status: "generated",
    },
  });

  try {
    await prisma.contentOutput.create({
      data: {
        userId,
        learningSessionId: updated.id,
        outputType: SESSION_QUIZ_OUTPUT_TYPE,
        title: `Quiz — ${session.topic}`,
        content: `Structured quiz (${quizPack.questions.length} questions)`,
        metaJson: {
          source: "quiz-ai",
          questions: quizPack.questions,
          assessmentMeta: quizPack.assessmentMeta,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("[quiz_persist_failed]", { sessionId: updated.id, userId, error });
  }

  console.info("[lesson_quality_meta]", {
    userId,
    sessionId: session.id,
    planTier,
    qualityMeta: aiLesson.qualityMeta,
  });

  return {
    session: updated,
    lesson: {
      lessonTitle: aiLesson.lessonTitle,
      lessonSummary: aiLesson.lessonSummary,
      lessonBody: aiLesson.lessonBody,
      wowFacts: aiLesson.wowFacts,
      quizQuestions: aiLesson.quizQuestions,
    },
    quiz: {
      questions: quizPack.questions,
      assessmentMeta: quizPack.assessmentMeta,
    },
    aiMeta: aiLesson.aiMeta,
    qualityMeta: aiLesson.qualityMeta,
  };
}

export async function createQuizAttemptForSession(
  userId: string,
  sessionId: string,
  input: CreateQuizAttemptInput,
) {
  await getOwnedSessionOrThrow(userId, sessionId);

  const quizOutput = await prisma.contentOutput.findFirst({
    where: {
      userId,
      learningSessionId: sessionId,
      outputType: SESSION_QUIZ_OUTPUT_TYPE,
    },
    orderBy: { createdAt: "desc" },
  });

  const questions = parseQuizQuestionsFromMeta(quizOutput?.metaJson) ?? [];

  if (questions.length === 0) {
    throw new AppError(400, "No AI quiz found for this session. Generate the lesson first.", {
      code: "VALIDATION_ERROR",
    });
  }

  const assessment = await evaluateQuizAttempt({
    questions,
    answersJson: input.answersJson,
    ...(input.totalQuestions !== undefined ? { totalQuestions: input.totalQuestions } : {}),
  });

  const answersPayload: Prisma.InputJsonValue = {
    submitted: input.answersJson,
    assessment: {
      score: assessment.score,
      correctCount: assessment.correctCount,
      totalQuestions: assessment.totalQuestions,
      strengths: assessment.strengths,
      weaknesses: assessment.weaknesses,
      recommendedFocus: assessment.recommendedFocus,
      perQuestion: assessment.perQuestion,
    },
  };

  const attempt = await prisma.quizAttempt.create({
    data: {
      userId,
      learningSessionId: sessionId,
      answersJson: answersPayload,
      totalQuestions: assessment.totalQuestions,
      score: assessment.score,
      feedback: assessment.feedback,
    },
  });

  return {
    quizAttempt: attempt,
    assessment,
  };
}

export async function createContentOutputForSession(
  userId: string,
  sessionId: string,
  input: CreateContentOutputInput,
) {
  const session = await getOwnedSessionOrThrow(userId, sessionId);

  if (!session.lessonTitle || !session.lessonSummary || !session.lessonBody) {
    throw new AppError(400, "Lesson must be generated before creating outputs", {
      code: "VALIDATION_ERROR",
    });
  }

  const generated = await generateContentFromLesson(
    input.outputType,
    {
      lessonTitle: session.lessonTitle,
      lessonSummary: session.lessonSummary,
      lessonBody: session.lessonBody,
    },
    {
      planTier: resolvePlanTierForUser(userId),
    },
  );

  const output = await prisma.contentOutput.create({
    data: {
      userId,
      learningSessionId: sessionId,
      outputType: input.outputType,
      title: generated.title,
      content: generated.content,
      metaJson: {
        ...generated.metaJson,
        lessonTitle: session.lessonTitle,
        generatedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  return output;
}

export async function getContentOutputsForSession(
  userId: string,
  sessionId: string,
) {
  await getOwnedSessionOrThrow(userId, sessionId);

  const outputs = await prisma.contentOutput.findMany({
    where: {
      userId,
      learningSessionId: sessionId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return outputs;
}

export async function createLongformOutputForSession(
  userId: string,
  sessionId: string,
  input: CreateLongformInput,
) {
  const session = await getOwnedSessionOrThrow(userId, sessionId);

  if (!session.lessonTitle || !session.lessonSummary || !session.lessonBody) {
    throw new AppError(400, "Lesson must be generated before creating long-form output", {
      code: "VALIDATION_ERROR",
    });
  }

  const learningDna = await prisma.learningDNA.findUnique({
    where: { userId },
  });

  const planTier = resolvePlanTierForUser(userId);

  const difficulty =
    session.difficulty ?? learningDna?.preferredDifficulty ?? "beginner";
  const tone =
    input.tone ??
    session.tone ??
    learningDna?.preferredTone ??
    "friendly";
  const language = learningDna?.language ?? "tr";

  let longform = await generateLongformVideoWithAI({
    userId,
    topic: session.topic,
    curiosityPrompt: session.curiosityPrompt,
    lessonTitle: session.lessonTitle,
    lessonSummary: session.lessonSummary,
    lessonBody: session.lessonBody,
    difficulty,
    tone,
    language,
    durationMinutes: input.durationMinutes,
    planTier,
  });

  if (input.targetAudience !== undefined) {
    longform = { ...longform, targetAudience: input.targetAudience };
  }

  const content = buildLongformReadableContent(longform);

  await prisma.contentOutput.create({
    data: {
      userId,
      learningSessionId: sessionId,
      outputType: LONGFORM_OUTPUT_TYPE,
      title: longform.title,
      content,
      metaJson: longform as unknown as Prisma.InputJsonValue,
    },
  });

  return { longform };
}

export async function getLongformOutputForSession(
  userId: string,
  sessionId: string,
) {
  await getOwnedSessionOrThrow(userId, sessionId);

  const row = await prisma.contentOutput.findFirst({
    where: {
      userId,
      learningSessionId: sessionId,
      outputType: LONGFORM_OUTPUT_TYPE,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!row || row.metaJson === null || row.metaJson === undefined) {
    throw new AppError(404, "Long-form video script not found for this session", {
      code: "NOT_FOUND",
    });
  }

  const parsed = longformVideoResultSchema.safeParse(row.metaJson);
  if (!parsed.success) {
    throw new AppError(500, "Stored long-form data is invalid", {
      code: "INTERNAL_ERROR",
    });
  }

  return { longform: parsed.data };
}

const SHARE_PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

export async function recordContentShare(
  userId: string,
  contentOutputId: string,
  input: RecordContentShareInput,
) {
  const output = await prisma.contentOutput.findFirst({
    where: {
      id: contentOutputId,
      userId,
    },
    select: {
      id: true,
      learningSessionId: true,
      outputType: true,
      title: true,
    },
  });

  if (!output) {
    throw new AppError(404, "Content output not found", { code: "NOT_FOUND" });
  }

  const share = await prisma.contentShare.upsert({
    where: {
      userId_contentOutputId_platform: {
        userId,
        contentOutputId,
        platform: input.platform,
      },
    },
    create: {
      userId,
      contentOutputId,
      platform: input.platform,
      shareCount: 1,
    },
    update: {
      shareCount: { increment: 1 },
    },
  });

  const platformTotals = await prisma.contentShare.groupBy({
    by: ["platform"],
    where: { contentOutputId },
    _sum: { shareCount: true },
  });

  const sharesByPlatform: Record<(typeof SHARE_PLATFORMS)[number], number> = {
    tiktok: 0,
    instagram: 0,
    youtube: 0,
  };

  let totalShareEvents = 0;
  for (const row of platformTotals) {
    const n = row._sum.shareCount ?? 0;
    totalShareEvents += n;
    if (row.platform === "tiktok" || row.platform === "instagram" || row.platform === "youtube") {
      sharesByPlatform[row.platform] = n;
    }
  }

  const distinctSharers = await prisma.contentShare.groupBy({
    by: ["userId"],
    where: { contentOutputId },
  });

  return {
    share: {
      id: share.id,
      userId: share.userId,
      contentId: share.contentOutputId,
      platform: share.platform,
      shareCount: share.shareCount,
      createdAt: share.createdAt,
      updatedAt: share.updatedAt,
    },
    stats: {
      contentOutputId: output.id,
      learningSessionId: output.learningSessionId,
      outputType: output.outputType,
      title: output.title,
      totalShareEvents,
      sharesByPlatform,
      uniqueSharers: distinctSharers.length,
      rankingHints: {
        schemaVersion: 1,
        aggregation: "content_output_share_totals",
        weightedEngagementProxy: totalShareEvents,
      },
    },
  };
}
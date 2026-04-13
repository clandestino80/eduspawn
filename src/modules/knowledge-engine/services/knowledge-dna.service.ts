import type { Prisma } from "@prisma/client";
import { KnowledgeNodeKind, KnowledgeSourceType } from "@prisma/client";
import { getEnv } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import { learningDnaSignalsV1Schema, type LearningDnaSignalsV1 } from "../knowledge-engine.schema";
import { inferDomainBucketFromTopic } from "./category-taxonomy.service";
import { buildCategoryNormalizedKeyV1 } from "../knowledge-keys";

const MAX_FAVORITE_TOPICS = 25;
const MAX_CATEGORY_KEYS = 20;
const REINFORCEMENT_EWMA_ALPHA = 0.35;

function defaultSignalsV1(): LearningDnaSignalsV1 {
  return {
    schemaVersion: 1,
    lessonsGeneratedTotal: 0,
    quizAttemptsTotal: 0,
    quizScoreSum: 0,
    reinforcementEwma: 0,
    recentCategoryNormalizedKeys: [],
    recentTaxonomyDomains: [],
    atomicConceptsLoggedTotal: 0,
  };
}

function parseSignals(raw: unknown): LearningDnaSignalsV1 {
  const base = defaultSignalsV1();
  if (raw === null || raw === undefined) {
    return { ...base };
  }
  const parsed = learningDnaSignalsV1Schema.safeParse(raw);
  if (!parsed.success) {
    return { ...base };
  }
  const d = parsed.data;
  return {
    ...base,
    ...d,
    schemaVersion: 1,
    lessonsGeneratedTotal: d.lessonsGeneratedTotal ?? base.lessonsGeneratedTotal,
    quizAttemptsTotal: d.quizAttemptsTotal ?? base.quizAttemptsTotal,
    quizScoreSum: d.quizScoreSum ?? base.quizScoreSum,
    reinforcementEwma: d.reinforcementEwma ?? base.reinforcementEwma,
    recentCategoryNormalizedKeys:
      d.recentCategoryNormalizedKeys ?? base.recentCategoryNormalizedKeys,
    recentTaxonomyDomains: d.recentTaxonomyDomains ?? base.recentTaxonomyDomains,
    atomicConceptsLoggedTotal:
      d.atomicConceptsLoggedTotal ?? base.atomicConceptsLoggedTotal,
  };
}

function mergeFavoriteTopics(existing: string[] | undefined, topic: string): string[] {
  const t = topic.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!t) return existing ?? [];
  const lower = t.toLowerCase();
  const base = [...(existing ?? [])].filter((x) => x.replace(/\s+/g, " ").trim().length > 0);
  const deduped = base.filter((x) => x.toLowerCase() !== lower);
  return [t, ...deduped].slice(0, MAX_FAVORITE_TOPICS);
}

function prependCategoryKey(keys: string[] | undefined, key: string): string[] {
  const k = key.trim();
  if (!k) return keys ?? [];
  const rest = (keys ?? []).filter((x) => x !== k);
  return [k, ...rest].slice(0, MAX_CATEGORY_KEYS);
}

const MAX_TAXONOMY_DOMAINS = 16;

function prependTaxonomyDomain(domains: string[] | undefined, domain: string): string[] {
  const d = domain.trim();
  if (!d) return domains ?? [];
  const rest = (domains ?? []).filter((x) => x !== d);
  return [d, ...rest].slice(0, MAX_TAXONOMY_DOMAINS);
}

/**
 * Slice E — after a lesson is generated and session row updated (deterministic, no LLM).
 * Merges topic into favoriteTopics, bumps lesson counters, tracks category hash trail, logs atom count.
 */
export async function recordLessonGeneratedDnaSignals(input: {
  userId: string;
  sessionId: string;
  topic: string;
  curiosityPrompt: string;
}): Promise<void> {
  if (!getEnv().KNOWLEDGE_ENGINE_ENABLED) {
    return;
  }

  const topicTrim = input.topic.trim();
  const curiosityTrim = input.curiosityPrompt.trim();
  const categoryKey = buildCategoryNormalizedKeyV1(topicTrim, curiosityTrim);
  const taxonomyDomain = inferDomainBucketFromTopic(
    topicTrim.length > 0 ? topicTrim : curiosityTrim,
  );

  let atomCount = 0;
  try {
    atomCount = await prisma.knowledgeNode.count({
      where: {
        userId: input.userId,
        kind: KnowledgeNodeKind.ATOMIC_CONCEPT,
        sourceType: KnowledgeSourceType.LESSON_ATOMIC,
        metadataJson: {
          path: ["learningSessionId"],
          equals: input.sessionId,
        },
      },
    });
  } catch {
    atomCount = 0;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.learningDNA.findUnique({
        where: { userId: input.userId },
        select: { favoriteTopics: true, signalsJson: true },
      });

      const signals = parseSignals(row?.signalsJson);
      const nextSignals: LearningDnaSignalsV1 = {
        ...signals,
        schemaVersion: 1,
        lessonsGeneratedTotal: (signals.lessonsGeneratedTotal ?? 0) + 1,
        recentCategoryNormalizedKeys: prependCategoryKey(
          signals.recentCategoryNormalizedKeys,
          categoryKey,
        ),
        recentTaxonomyDomains: prependTaxonomyDomain(
          signals.recentTaxonomyDomains,
          taxonomyDomain,
        ),
        atomicConceptsLoggedTotal:
          (signals.atomicConceptsLoggedTotal ?? 0) + atomCount,
      };

      const favoriteTopics = mergeFavoriteTopics(row?.favoriteTopics, input.topic);

      await tx.learningDNA.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          favoriteTopics,
          signalsJson: nextSignals as Prisma.InputJsonValue,
        },
        update: {
          favoriteTopics,
          signalsJson: nextSignals as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    console.error("[knowledge_dna_lesson_signals_failed]", {
      userId: input.userId,
      sessionId: input.sessionId,
      error,
    });
  }
}

/**
 * Slice E — after a quiz attempt is evaluated and persisted (deterministic, no LLM).
 */
export async function recordQuizAssessmentDnaSignals(input: {
  userId: string;
  score: number;
}): Promise<void> {
  if (!getEnv().KNOWLEDGE_ENGINE_ENABLED) {
    return;
  }

  const score = Math.max(0, Math.min(100, Math.round(input.score)));
  const strain = (100 - score) / 100;

  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.learningDNA.findUnique({
        where: { userId: input.userId },
        select: { favoriteTopics: true, signalsJson: true },
      });

      const signals = parseSignals(row?.signalsJson);
      const prevEwma = signals.reinforcementEwma ?? 0;
      const priorAttempts = signals.quizAttemptsTotal ?? 0;
      const nextEwma =
        priorAttempts === 0
          ? strain
          : REINFORCEMENT_EWMA_ALPHA * strain + (1 - REINFORCEMENT_EWMA_ALPHA) * prevEwma;

      const nextSignals: LearningDnaSignalsV1 = {
        ...signals,
        schemaVersion: 1,
        lessonsGeneratedTotal: signals.lessonsGeneratedTotal ?? 0,
        quizAttemptsTotal: (signals.quizAttemptsTotal ?? 0) + 1,
        quizScoreSum: (signals.quizScoreSum ?? 0) + score,
        reinforcementEwma: Math.max(0, Math.min(1, nextEwma)),
      };

      await tx.learningDNA.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          favoriteTopics: row?.favoriteTopics ?? [],
          signalsJson: nextSignals as Prisma.InputJsonValue,
        },
        update: {
          signalsJson: nextSignals as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    console.error("[knowledge_dna_quiz_signals_failed]", {
      userId: input.userId,
      error,
    });
  }
}

/**
 * Low-risk hints for Slice B (max 2 short lines). Returns [] if no row or insufficient data.
 */
export async function getDnaLessonContextHints(userId: string): Promise<string[]> {
  if (!getEnv().KNOWLEDGE_CONTEXT_INJECTION_ENABLED) {
    return [];
  }

  try {
    const row = await prisma.learningDNA.findUnique({
      where: { userId },
      select: { signalsJson: true },
    });
    if (!row?.signalsJson) {
      return [];
    }

    const s = parseSignals(row.signalsJson);
    const hints: string[] = [];

    const attempts = s.quizAttemptsTotal ?? 0;
    const sum = s.quizScoreSum ?? 0;
    if (attempts >= 2) {
      const avg = sum / attempts;
      if (avg < 62) {
        hints.push(
          "Profile hint: recent quiz scores suggest prioritizing reinforcement, plain-language explanations, and shorter reasoning jumps.",
        );
      } else if (avg >= 82) {
        hints.push(
          "Profile hint: recent quiz scores are strong — you can add slightly richer connections and stretch examples while staying clear.",
        );
      }
    }

    const lessons = s.lessonsGeneratedTotal ?? 0;
    const keys = s.recentCategoryNormalizedKeys ?? [];
    if (lessons >= 4 && keys.length >= 6) {
      hints.push(
        "Profile hint: repeated curiosity in similar areas — balance novelty with deeper mastery on core threads.",
      );
    }

    const ewma = s.reinforcementEwma ?? 0;
    if (hints.length < 2 && attempts >= 1 && ewma >= 0.55) {
      hints.push(
        "Profile hint: learning strain signal is elevated — prefer gentle scaffolding and explicit checkpoints.",
      );
    }

    return hints.slice(0, 2);
  } catch {
    return [];
  }
}

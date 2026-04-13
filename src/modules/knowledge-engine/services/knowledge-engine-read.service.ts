import { randomUUID } from "node:crypto";
import { withReadDbRetry } from "../../../lib/read-with-db-retry";
import { learningDnaSignalsV1Schema } from "../knowledge-engine.schema";
import * as knowledgeEngineReadRepository from "../repositories/knowledge-engine-read.repository";
import { assembleLessonPersonalMemoryContext } from "./knowledge-context.service";

const ALLOWED_METADATA_KEYS = new Set([
  "schemaVersion",
  "topic",
  "learningSessionId",
  "extraction",
  "modelKind",
  "wowFactsCount",
  "lessonBodyChars",
  "confidence",
]);

function sanitizeNodeMetadata(metadataJson: unknown): Record<string, unknown> | null {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) {
    return null;
  }
  const src = metadataJson as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_METADATA_KEYS) {
    if (key in src) {
      out[key] = src[key];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeArticleRelatedQuestions(json: unknown): string[] | null {
  if (!Array.isArray(json)) return null;
  const out = json.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return out.length > 0 ? out.slice(0, 12) : null;
}

function sanitizeSignalsSummary(signalsJson: unknown): Record<string, unknown> | null {
  if (signalsJson === null || signalsJson === undefined) {
    return null;
  }
  const parsed = learningDnaSignalsV1Schema.safeParse(signalsJson);
  if (!parsed.success) {
    return { parseError: true };
  }
  const s = parsed.data;
  const attempts = s.quizAttemptsTotal ?? 0;
  const sum = s.quizScoreSum ?? 0;
  const keys = s.recentCategoryNormalizedKeys ?? [];
  const domains = s.recentTaxonomyDomains ?? [];
  return {
    schemaVersion: s.schemaVersion ?? 1,
    lessonsGeneratedTotal: s.lessonsGeneratedTotal ?? 0,
    quizAttemptsTotal: attempts,
    quizScoreSum: sum,
    quizAvgScoreApprox:
      attempts > 0 ? Math.round((sum / attempts) * 10) / 10 : null,
    reinforcementEwma: s.reinforcementEwma ?? null,
    recentCategoryKeyCount: keys.length,
    recentCategoryKeysSample: keys.slice(0, 8),
    recentTaxonomyDomainCount: domains.length,
    recentTaxonomyDomainsSample: domains.slice(0, 8),
    atomicConceptsLoggedTotal: s.atomicConceptsLoggedTotal ?? null,
  };
}

export async function listKnowledgeNodesForReadApi(userId: string, take: number) {
  const rows = await withReadDbRetry(
    "knowledge_engine_read_nodes",
    () =>
      knowledgeEngineReadRepository.findKnowledgeNodesForUser({
        userId,
        take,
      }),
    { userId, take },
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    kind: row.kind,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    categoryId: row.categoryId,
    categoryTaxonomy: row.category
      ? {
          normalizedKey: row.category.normalizedKey,
          label: row.category.label,
          domain: row.category.domain,
          subdomain: row.category.subdomain,
          microTopic: row.category.microTopic,
        }
      : null,
    linkedGlobalConcept: row.category?.globalConcept
      ? {
          slug: row.category.globalConcept.slug,
          displayTitle: row.category.globalConcept.displayTitle,
          article: row.category.globalConcept.article
            ? {
                schemaVersion: row.category.globalConcept.article.schemaVersion,
                summary: row.category.globalConcept.article.summary,
                hook: row.category.globalConcept.article.hook,
                sourceType: row.category.globalConcept.article.sourceType,
                relatedQuestions: normalizeArticleRelatedQuestions(
                  row.category.globalConcept.article.relatedQuestionsJson,
                ),
              }
            : null,
        }
      : null,
    metadata: sanitizeNodeMetadata(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listKnowledgeEdgesForReadApi(userId: string, take: number) {
  const rows = await withReadDbRetry(
    "knowledge_engine_read_edges",
    () =>
      knowledgeEngineReadRepository.findKnowledgeEdgesForUser({
        userId,
        take,
      }),
    { userId, take },
  );
  return rows.map((row) => ({
    id: row.id,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    relationType: row.relationType,
    weight: row.weight,
    confidence: row.confidence,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function getLearningDnaReadSnapshot(userId: string) {
  const row = await withReadDbRetry("knowledge_engine_read_dna", () =>
    knowledgeEngineReadRepository.findLearningDnaRowForUser(userId),
  { userId });
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.userId,
    preferredTone: row.preferredTone,
    preferredDifficulty: row.preferredDifficulty,
    favoriteTopics: row.favoriteTopics,
    attentionSpanSeconds: row.attentionSpanSeconds,
    visualPreference: row.visualPreference,
    quizPreference: row.quizPreference,
    language: row.language,
    signalsSummary: sanitizeSignalsSummary(row.signalsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Uses the same assembly path as lesson generation (Slice B), with a synthetic session id
 * so the current session’s own seed node is not excluded incorrectly for ad-hoc previews.
 */
export async function getMemoryPreviewForReadApi(input: {
  userId: string;
  topic: string;
  curiosityPrompt: string;
}) {
  const previewSessionId = randomUUID();
  const context = await withReadDbRetry(
    "knowledge_engine_memory_preview",
    () =>
      assembleLessonPersonalMemoryContext({
        userId: input.userId,
        session: {
          id: previewSessionId,
          topic: input.topic,
          curiosityPrompt: input.curiosityPrompt,
        },
      }),
    { userId: input.userId, previewSessionId },
  );

  return {
    topic: input.topic,
    curiosityPrompt: input.curiosityPrompt,
    previewSessionId,
    context: context ?? null,
  };
}

import { z } from "zod";

/**
 * One atomic concept extracted from a generated lesson (Slice C).
 * Kept compact for reuse in prompts and UI later.
 */
export const extractedLessonAtomSchema = z
  .object({
    title: z.string().min(1).max(180),
    summary: z.string().max(420).optional(),
    /** Free-form subtype hint from the model (e.g. definition, analogy, pitfall). */
    kind: z.string().max(64).optional(),
    /** Model self-rating 0–1; stored in metadataJson only. */
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

/**
 * Full extraction payload from the LLM (strict — unknown keys rejected).
 */
export const lessonKnowledgeExtractionResultSchema = z
  .object({
    concepts: z.array(extractedLessonAtomSchema).min(1).max(6),
  })
  .strict();

export type ExtractedLessonAtom = z.infer<typeof extractedLessonAtomSchema>;
export type LessonKnowledgeExtractionResult = z.infer<
  typeof lessonKnowledgeExtractionResultSchema
>;

/**
 * Slice E — versioned behavioral signals merged into LearningDNA.signalsJson.
 * Fields are optional at parse time so older/partial documents still merge safely.
 */
export const learningDnaSignalsV1Schema = z
  .object({
    schemaVersion: z.number().int().optional(),
    lessonsGeneratedTotal: z.number().int().nonnegative().optional(),
    quizAttemptsTotal: z.number().int().nonnegative().optional(),
    quizScoreSum: z.number().int().nonnegative().optional(),
    reinforcementEwma: z.number().min(0).max(1).optional(),
    recentCategoryNormalizedKeys: z.array(z.string().max(200)).max(24).optional(),
    /** Slice H — coarse domain buckets aligned with KnowledgeCategory.domain slugs. */
    recentTaxonomyDomains: z.array(z.string().max(64)).max(16).optional(),
    atomicConceptsLoggedTotal: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type LearningDnaSignalsV1 = z.infer<typeof learningDnaSignalsV1Schema>;

/** Slice F — read API query validation. */
export const knowledgeEngineListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

export const knowledgeEngineMemoryPreviewQuerySchema = z.object({
  topic: z.string().trim().min(2).max(180),
  curiosityPrompt: z.string().trim().max(2000).optional(),
});

export type KnowledgeEngineListQuery = z.infer<typeof knowledgeEngineListQuerySchema>;
export type KnowledgeEngineMemoryPreviewQuery = z.infer<
  typeof knowledgeEngineMemoryPreviewQuerySchema
>;

/** Global concept catalog reads (authenticated, versioned under /knowledge-engine). */
export const globalConceptListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  domain: z.string().trim().max(64).optional(),
  subdomain: z.string().trim().max(80).optional(),
});

export type GlobalConceptListQuery = z.infer<typeof globalConceptListQuerySchema>;

/** Deterministic global concept recommendations (read-only, authenticated). */
export const globalConceptRecommendedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).optional().default(12),
  domain: z.string().trim().max(64).optional(),
  subdomain: z.string().trim().max(80).optional(),
  mode: z.enum(["user", "featured"]).optional().default("user"),
});

export type GlobalConceptRecommendedQuery = z.infer<typeof globalConceptRecommendedQuerySchema>;

/** Slice B — global memory-first topic feed (read-only inventory, no generation). */
export const topicFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  domain: z.string().trim().max(64).optional(),
  subdomain: z.string().trim().max(80).optional(),
});

export type TopicFeedQuery = z.infer<typeof topicFeedQuerySchema>;

/** Read-only saved topic list (user’s `savedAt` rows). */
export const topicSavedListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export type TopicSavedListQuery = z.infer<typeof topicSavedListQuerySchema>;

/** Slice F — `GlobalTopicInventory.id` on topic interaction routes (`/topics/:id/...`). */
export const topicInventoryIdParamsSchema = z.object({
  id: z.string().trim().min(12).max(128),
});

export type TopicInventoryIdParams = z.infer<typeof topicInventoryIdParamsSchema>;

/** Ops: POST .../concepts/:slug/enrich — preview without writes when dryRun=true|1|yes. */
export const globalConceptEnrichOpsQuerySchema = z
  .object({
    dryRun: z.enum(["true", "false", "1", "0", "yes"]).optional(),
  })
  .transform((q) => ({
    dryRun: q.dryRun === "true" || q.dryRun === "1" || q.dryRun === "yes",
  }));

export type GlobalConceptEnrichOpsQuery = z.infer<typeof globalConceptEnrichOpsQuerySchema>;

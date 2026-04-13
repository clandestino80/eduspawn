import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export type UpsertGlobalConceptArticleSeedRepositoryInput = {
  globalConceptId: string;
  schemaVersion: number;
  summary: string;
  hook: string | null;
  relatedQuestionsJson: Prisma.InputJsonValue | undefined;
  sourceType: string;
};

/**
 * Idempotent upsert: one article row per GlobalConcept (@@unique(globalConceptId)).
 */
export async function findGlobalConceptArticleBriefByConceptId(globalConceptId: string) {
  return prisma.globalConceptArticle.findUnique({
    where: { globalConceptId },
    select: {
      id: true,
      sourceType: true,
      summary: true,
      hook: true,
      relatedQuestionsJson: true,
    },
  });
}

export type ApplyGlobalConceptArticleAiEnrichmentRepositoryInput = {
  globalConceptId: string;
  summary: string;
  hook: string | null;
  relatedQuestionsJson: Prisma.InputJsonValue;
  sourceType: string;
  enrichmentProvenanceJson: Prisma.InputJsonValue;
};

/**
 * Applies AI-enriched fields only while the row is still deterministic_seed_v1 (race-safe).
 */
export async function applyGlobalConceptArticleAiEnrichmentV1(
  input: ApplyGlobalConceptArticleAiEnrichmentRepositoryInput,
): Promise<{ updated: number }> {
  const result = await prisma.globalConceptArticle.updateMany({
    where: {
      globalConceptId: input.globalConceptId,
      sourceType: "deterministic_seed_v1",
    },
    data: {
      summary: input.summary,
      hook: input.hook,
      relatedQuestionsJson: input.relatedQuestionsJson,
      sourceType: input.sourceType,
      enrichmentProvenanceJson: input.enrichmentProvenanceJson,
    },
  });
  return { updated: result.count };
}

export async function upsertGlobalConceptArticleSeedV1(
  input: UpsertGlobalConceptArticleSeedRepositoryInput,
): Promise<{ id: string }> {
  return prisma.globalConceptArticle.upsert({
    where: { globalConceptId: input.globalConceptId },
    create: {
      globalConceptId: input.globalConceptId,
      schemaVersion: input.schemaVersion,
      summary: input.summary,
      hook: input.hook,
      ...(input.relatedQuestionsJson !== undefined
        ? { relatedQuestionsJson: input.relatedQuestionsJson }
        : {}),
      sourceType: input.sourceType,
    },
    update: {
      schemaVersion: input.schemaVersion,
      summary: input.summary,
      hook: input.hook,
      ...(input.relatedQuestionsJson !== undefined
        ? { relatedQuestionsJson: input.relatedQuestionsJson }
        : {}),
      sourceType: input.sourceType,
    },
    select: { id: true },
  });
}

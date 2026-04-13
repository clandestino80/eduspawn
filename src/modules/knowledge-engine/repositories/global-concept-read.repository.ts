import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

const articleSelect = {
  schemaVersion: true,
  summary: true,
  hook: true,
  relatedQuestionsJson: true,
  sourceType: true,
} as const;

export type GlobalConceptRowWithArticleAndCategoryCount = Prisma.GlobalConceptGetPayload<{
  include: {
    article: { select: typeof articleSelect };
    _count: { select: { categories: true } };
  };
}>;

/**
 * Concept-level read: one GlobalConcept by slug with article and category link count.
 */
export async function findGlobalConceptBySlugForRead(
  slug: string,
): Promise<GlobalConceptRowWithArticleAndCategoryCount | null> {
  return prisma.globalConcept.findUnique({
    where: { slug },
    include: {
      article: { select: articleSelect },
      _count: { select: { categories: true } },
    },
  });
}

/**
 * Bounded list for internal / product browsing (newest touch first).
 */
export async function findGlobalConceptsForReadList(params: {
  take: number;
  domain?: string;
  subdomain?: string;
}): Promise<GlobalConceptRowWithArticleAndCategoryCount[]> {
  const where: Prisma.GlobalConceptWhereInput = {};
  if (params.domain !== undefined && params.domain.trim().length > 0) {
    where.domain = params.domain.trim();
  }
  if (params.subdomain !== undefined && params.subdomain.trim().length > 0) {
    where.subdomain = params.subdomain.trim();
  }

  return prisma.globalConcept.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: params.take,
    include: {
      article: { select: articleSelect },
      _count: { select: { categories: true } },
    },
  });
}

const RECOMMENDATION_CANDIDATE_CAP = 320;

/**
 * Bounded pool for deterministic in-memory ranking (recommendations).
 * Same shape as {@link findGlobalConceptsForReadList}; callers should cap `take` before calling.
 */
export async function findGlobalConceptsForRecommendationCandidates(params: {
  take: number;
  domain?: string;
  subdomain?: string;
}): Promise<GlobalConceptRowWithArticleAndCategoryCount[]> {
  const take = Math.min(Math.max(1, params.take), RECOMMENDATION_CANDIDATE_CAP);
  return findGlobalConceptsForReadList({
    take,
    domain: params.domain,
    subdomain: params.subdomain,
  });
}

/**
 * Count KnowledgeNode rows linked through a category to this global concept.
 */
export async function countKnowledgeNodesLinkedToGlobalConcept(globalConceptId: string): Promise<number> {
  return prisma.knowledgeNode.count({
    where: {
      category: { globalConceptId },
    },
  });
}

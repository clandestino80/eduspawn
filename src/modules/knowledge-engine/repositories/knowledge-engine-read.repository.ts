import { prisma } from "../../../lib/prisma";

/**
 * Prisma-only reads for Slice F debug/read API.
 */
export async function findKnowledgeNodesForUser(params: {
  userId: string;
  take: number;
}) {
  return prisma.knowledgeNode.findMany({
    where: { userId: params.userId },
    orderBy: { updatedAt: "desc" },
    take: params.take,
    select: {
      id: true,
      title: true,
      summary: true,
      kind: true,
      sourceType: true,
      sourceId: true,
      categoryId: true,
      metadataJson: true,
      createdAt: true,
      updatedAt: true,
      category: {
        select: {
          normalizedKey: true,
          label: true,
          domain: true,
          subdomain: true,
          microTopic: true,
          globalConcept: {
            select: {
              slug: true,
              displayTitle: true,
              article: {
                select: {
                  schemaVersion: true,
                  summary: true,
                  hook: true,
                  relatedQuestionsJson: true,
                  sourceType: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function findKnowledgeEdgesForUser(params: {
  userId: string;
  take: number;
}) {
  return prisma.knowledgeEdge.findMany({
    where: { userId: params.userId },
    orderBy: { updatedAt: "desc" },
    take: params.take,
    select: {
      id: true,
      fromNodeId: true,
      toNodeId: true,
      relationType: true,
      weight: true,
      confidence: true,
      sourceType: true,
      sourceId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function findLearningDnaRowForUser(userId: string) {
  return prisma.learningDNA.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      preferredTone: true,
      preferredDifficulty: true,
      favoriteTopics: true,
      attentionSpanSeconds: true,
      visualPreference: true,
      quizPreference: true,
      language: true,
      signalsJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Recent category rows for global concept recommendations (touchpoints + coarse domains).
 */
export async function findUserCategorySignalsForConceptRecommendations(userId: string) {
  return prisma.knowledgeCategory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      globalConceptId: true,
      domain: true,
      subdomain: true,
      normalizedKey: true,
      updatedAt: true,
    },
  });
}

import { KnowledgeNodeKind, KnowledgeRelationType, KnowledgeSourceType } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export type KnowledgeContextNodeRow = {
  id: string;
  title: string;
  summary: string | null;
  sourceId: string;
  updatedAt: Date;
  categoryId: string | null;
  metadataJson: unknown;
  category: {
    normalizedKey: string;
    label: string;
    domain: string | null;
    subdomain: string | null;
  } | null;
};

/**
 * Prisma-only reads for Slice B context assembly.
 */
export async function listRecentKnowledgeNodesForLessonContext(params: {
  userId: string;
  excludeSourceId: string;
  take: number;
}): Promise<KnowledgeContextNodeRow[]> {
  return prisma.knowledgeNode.findMany({
    where: {
      userId: params.userId,
      OR: [
        {
          kind: KnowledgeNodeKind.SESSION_LESSON,
          sourceType: KnowledgeSourceType.LEARNING_SESSION,
        },
        {
          kind: KnowledgeNodeKind.ATOMIC_CONCEPT,
          sourceType: KnowledgeSourceType.LESSON_ATOMIC,
        },
      ],
      NOT: { sourceId: params.excludeSourceId },
    },
    orderBy: { updatedAt: "desc" },
    take: params.take,
    select: {
      id: true,
      title: true,
      summary: true,
      sourceId: true,
      updatedAt: true,
      categoryId: true,
      metadataJson: true,
      category: {
        select: { normalizedKey: true, label: true, domain: true, subdomain: true },
      },
    },
  });
}

/**
 * One-hop edges from a bounded set of anchor nodes (Slice G).
 * RELATED_TO and REINFORCES are used for lesson-context expansion; other types ignored here.
 */
export async function findEdgesIncidentToNodes(params: {
  userId: string;
  nodeIds: string[];
  relationTypes: KnowledgeRelationType[];
}): Promise<
  {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    relationType: KnowledgeRelationType;
    updatedAt: Date;
  }[]
> {
  if (params.nodeIds.length === 0) {
    return [];
  }
  return prisma.knowledgeEdge.findMany({
    where: {
      userId: params.userId,
      relationType: { in: params.relationTypes },
      OR: [{ fromNodeId: { in: params.nodeIds } }, { toNodeId: { in: params.nodeIds } }],
    },
    select: {
      id: true,
      fromNodeId: true,
      toNodeId: true,
      relationType: true,
      updatedAt: true,
    },
  });
}

export async function findKnowledgeContextNodesByIds(params: {
  userId: string;
  ids: string[];
}): Promise<KnowledgeContextNodeRow[]> {
  if (params.ids.length === 0) {
    return [];
  }
  return prisma.knowledgeNode.findMany({
    where: { userId: params.userId, id: { in: params.ids } },
    select: {
      id: true,
      title: true,
      summary: true,
      sourceId: true,
      updatedAt: true,
      categoryId: true,
      metadataJson: true,
      category: {
        select: { normalizedKey: true, label: true, domain: true, subdomain: true },
      },
    },
  });
}

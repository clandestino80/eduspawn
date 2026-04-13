import type { KnowledgeRelationType } from "@prisma/client";
import { KnowledgeNodeKind, KnowledgeSourceType } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export type UpsertKnowledgeEdgeRepositoryInput = {
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: KnowledgeRelationType;
  sourceType: string;
  sourceId: string;
  weight?: number | null;
  confidence?: number | null;
};

/**
 * Prisma-only upsert for KnowledgeEdge on the composite unique key.
 */
export async function upsertKnowledgeEdge(
  input: UpsertKnowledgeEdgeRepositoryInput,
): Promise<{ id: string }> {
  const weight = input.weight ?? undefined;
  const confidence = input.confidence ?? undefined;

  const row = await prisma.knowledgeEdge.upsert({
    where: {
      userId_fromNodeId_toNodeId_relationType_sourceType_sourceId: {
        userId: input.userId,
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        relationType: input.relationType,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    create: {
      userId: input.userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      relationType: input.relationType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...(weight !== undefined ? { weight } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    },
    update: {
      ...(weight !== undefined ? { weight } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    },
    select: { id: true },
  });

  return row;
}

export async function findSeedLessonNodeId(
  userId: string,
  sessionId: string,
): Promise<{ id: string } | null> {
  return prisma.knowledgeNode.findUnique({
    where: {
      userId_sourceType_sourceId: {
        userId,
        sourceType: KnowledgeSourceType.LEARNING_SESSION,
        sourceId: sessionId,
      },
    },
    select: { id: true },
  });
}

export async function findAtomicNodeIdsForSession(
  userId: string,
  sessionId: string,
): Promise<{ id: string }[]> {
  return prisma.knowledgeNode.findMany({
    where: {
      userId,
      kind: KnowledgeNodeKind.ATOMIC_CONCEPT,
      sourceType: KnowledgeSourceType.LESSON_ATOMIC,
      metadataJson: {
        path: ["learningSessionId"],
        equals: sessionId,
      },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
}

import type { KnowledgeNodeKind, KnowledgeSourceType, Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export type UpsertKnowledgeNodeRepositoryInput = {
  userId: string;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  title: string;
  summary: string | null;
  kind: KnowledgeNodeKind;
  categoryId: string | null;
  metadataJson?: Prisma.InputJsonValue;
};

/**
 * Prisma-only upsert for KnowledgeNode on @@unique([userId, sourceType, sourceId]).
 */
export async function upsertKnowledgeNode(
  input: UpsertKnowledgeNodeRepositoryInput,
): Promise<{ id: string }> {
  const row = await prisma.knowledgeNode.upsert({
    where: {
      userId_sourceType_sourceId: {
        userId: input.userId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    create: {
      userId: input.userId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      summary: input.summary,
      kind: input.kind,
      categoryId: input.categoryId,
      ...(input.metadataJson !== undefined ? { metadataJson: input.metadataJson } : {}),
    },
    update: {
      title: input.title,
      summary: input.summary,
      kind: input.kind,
      categoryId: input.categoryId,
      ...(input.metadataJson !== undefined ? { metadataJson: input.metadataJson } : {}),
    },
    select: { id: true },
  });

  return row;
}

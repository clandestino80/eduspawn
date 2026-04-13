import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export type KnowledgeCategoryTaxonomyPatch = {
  domain?: string;
  subdomain?: string;
  microTopic?: string;
  difficultySignal?: string;
  formatAffinity?: string;
  intentHint?: string;
};

export type UpsertKnowledgeCategoryRepositoryInput = {
  userId: string;
  normalizedKey: string;
  label: string;
  sourceSessionId: string | null;
  weight?: number | null;
  confidence?: number | null;
};

/**
 * Prisma-only upsert for KnowledgeCategory on @@unique([userId, normalizedKey]).
 */
export async function upsertKnowledgeCategory(
  input: UpsertKnowledgeCategoryRepositoryInput,
): Promise<{ id: string }> {
  const weight = input.weight ?? undefined;
  const confidence = input.confidence ?? undefined;

  const row = await prisma.knowledgeCategory.upsert({
    where: {
      userId_normalizedKey: {
        userId: input.userId,
        normalizedKey: input.normalizedKey,
      },
    },
    create: {
      userId: input.userId,
      normalizedKey: input.normalizedKey,
      label: input.label,
      sourceSessionId: input.sourceSessionId,
      ...(weight !== undefined ? { weight } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    },
    update: {
      label: input.label,
      sourceSessionId: input.sourceSessionId,
      ...(weight !== undefined ? { weight } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    },
    select: { id: true },
  });

  return row;
}

/**
 * Partial taxonomy update (Slice H). Only provided keys are written.
 */
export async function updateKnowledgeCategoryTaxonomyFields(
  userId: string,
  categoryId: string,
  patch: KnowledgeCategoryTaxonomyPatch,
): Promise<void> {
  const data: Prisma.KnowledgeCategoryUpdateInput = {};
  if (patch.domain !== undefined) data.domain = patch.domain;
  if (patch.subdomain !== undefined) data.subdomain = patch.subdomain;
  if (patch.microTopic !== undefined) data.microTopic = patch.microTopic;
  if (patch.difficultySignal !== undefined) data.difficultySignal = patch.difficultySignal;
  if (patch.formatAffinity !== undefined) data.formatAffinity = patch.formatAffinity;
  if (patch.intentHint !== undefined) data.intentHint = patch.intentHint;

  if (Object.keys(data).length === 0) {
    return;
  }

  await prisma.knowledgeCategory.updateMany({
    where: { id: categoryId, userId },
    data,
  });
}

export type KnowledgeCategoryPendingGlobalConceptLinkRow = {
  id: string;
  userId: string;
  domain: string | null;
  subdomain: string | null;
  microTopic: string | null;
  label: string;
};

/**
 * Categories with taxonomy present but not yet linked to GlobalConcept (Slice J backfill).
 * Cursor is exclusive on id (asc) for stable batching.
 */
export async function findKnowledgeCategoriesPendingGlobalConceptLinkV1(params: {
  afterId: string | null;
  take: number;
}): Promise<KnowledgeCategoryPendingGlobalConceptLinkRow[]> {
  return prisma.knowledgeCategory.findMany({
    where: {
      globalConceptId: null,
      domain: { not: null },
      subdomain: { not: null },
      ...(params.afterId ? { id: { gt: params.afterId } } : {}),
    },
    orderBy: { id: "asc" },
    take: params.take,
    select: {
      id: true,
      userId: true,
      domain: true,
      subdomain: true,
      microTopic: true,
      label: true,
    },
  });
}


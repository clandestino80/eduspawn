import { prisma } from "../../../lib/prisma";

export type UpsertGlobalConceptRepositoryInput = {
  slug: string;
  displayTitle: string;
  domain: string;
  subdomain: string;
  microTopic: string | null;
  mappingKey: string | null;
};

/**
 * Prisma-only upsert for GlobalConcept on @@unique(slug). Slice J — deterministic slug from taxonomy V1.
 */
export async function upsertGlobalConceptBySlug(
  input: UpsertGlobalConceptRepositoryInput,
): Promise<{ id: string }> {
  const row = await prisma.globalConcept.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      displayTitle: input.displayTitle,
      domain: input.domain,
      subdomain: input.subdomain,
      microTopic: input.microTopic,
      mappingKey: input.mappingKey,
    },
    update: {
      displayTitle: input.displayTitle,
      domain: input.domain,
      subdomain: input.subdomain,
      microTopic: input.microTopic,
      mappingKey: input.mappingKey,
    },
    select: { id: true },
  });
  return row;
}

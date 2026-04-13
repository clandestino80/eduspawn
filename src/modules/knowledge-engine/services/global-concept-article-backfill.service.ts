import { prisma } from "../../../lib/prisma";
import type { UpsertGlobalConceptRepositoryInput } from "../repositories/global-concept.repository";
import { tryEnsureGlobalConceptArticleSeedV1 } from "./global-concept-article-seed.service";

const DEFAULT_LIMIT = 20_000;
const DEFAULT_BATCH = 200;

export type GlobalConceptArticleBackfillSummaryV1 = {
  dryRun: boolean;
  limit: number;
  batchSize: number;
  scanned: number;
  seeded: number;
  skippedInsufficientFields: number;
  skippedDisabled: number;
  failed: number;
};

function toUpsertInput(row: {
  slug: string;
  displayTitle: string;
  domain: string | null;
  subdomain: string | null;
  microTopic: string | null;
  mappingKey: string | null;
}): UpsertGlobalConceptRepositoryInput | null {
  const domain = row.domain?.trim() ?? "";
  const subdomain = row.subdomain?.trim() ?? "";
  if (domain.length === 0 || subdomain.length === 0) {
    return null;
  }
  return {
    slug: row.slug,
    displayTitle: row.displayTitle,
    domain,
    subdomain,
    microTopic: row.microTopic?.trim() ?? null,
    mappingKey: row.mappingKey,
  };
}

/**
 * Ops backfill: create article seeds for GlobalConcept rows missing GlobalConceptArticle.
 * Reuses the same deterministic seed path as the live bridge (no LLM).
 */
export async function runGlobalConceptArticleSeedBackfillV1(input?: {
  dryRun?: boolean;
  limit?: number;
  batchSize?: number;
}): Promise<GlobalConceptArticleBackfillSummaryV1> {
  const dryRun = input?.dryRun === true;
  const limit = Math.max(1, Math.min(input?.limit ?? DEFAULT_LIMIT, 200_000));
  const batchSize = Math.max(1, Math.min(input?.batchSize ?? DEFAULT_BATCH, 5_000));

  const summary: GlobalConceptArticleBackfillSummaryV1 = {
    dryRun,
    limit,
    batchSize,
    scanned: 0,
    seeded: 0,
    skippedInsufficientFields: 0,
    skippedDisabled: 0,
    failed: 0,
  };

  let afterId: string | null = null;

  while (summary.scanned < limit) {
    const take = Math.min(batchSize, limit - summary.scanned);
    if (take <= 0) break;

    const batch: Array<{
      id: string;
      slug: string;
      displayTitle: string;
      domain: string | null;
      subdomain: string | null;
      microTopic: string | null;
      mappingKey: string | null;
    }> = await prisma.globalConcept.findMany({
      where: {
        article: { is: null },
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        slug: true,
        displayTitle: true,
        domain: true,
        subdomain: true,
        microTopic: true,
        mappingKey: true,
      },
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      if (summary.scanned >= limit) break;
      summary.scanned += 1;

      const fields = toUpsertInput(row);
      if (!fields) {
        summary.skippedInsufficientFields += 1;
        console.info("[global_concept_article_backfill_skipped]", {
          globalConceptId: row.id,
          reason: "INSUFFICIENT_TAXONOMY_FIELDS",
        });
        continue;
      }

      if (dryRun) {
        summary.seeded += 1;
        console.info("[global_concept_article_backfill_row_dry_run]", {
          globalConceptId: row.id,
          slug: row.slug,
        });
        continue;
      }

      const outcome = await tryEnsureGlobalConceptArticleSeedV1({
        globalConceptId: row.id,
        conceptFields: fields,
        logContext: { backfill: true },
        skipAiEnrichment: true,
      });
      if (outcome === "upserted") {
        summary.seeded += 1;
      } else if (outcome === "skipped_disabled") {
        summary.skippedDisabled += 1;
      } else {
        summary.failed += 1;
      }
    }

    afterId = batch[batch.length - 1]!.id;
    if (batch.length < take) break;
  }

  console.info("[global_concept_article_backfill_summary]", summary);
  return summary;
}

import { getEnv } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import { runGlobalConceptArticleAiEnrichmentForConceptV1 } from "./global-concept-article-enrichment.service";

const DEFAULT_LIMIT = 500;
const DEFAULT_BATCH = 25;

export type GlobalConceptArticleAiEnrichmentBackfillSummaryV1 = {
  dryRun: boolean;
  limit: number;
  batchSize: number;
  scanned: number;
  applied: number;
  dryRunEligible: number;
  skippedDisabled: number;
  skippedNotEligible: number;
  skippedValidation: number;
  skippedNoop: number;
  skippedRace: number;
  failed: number;
};

/**
 * Ops backfill: run bounded AI enrichment on existing deterministic GlobalConceptArticle rows.
 * Requires KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED (and article flags) unless dryRun.
 */
export async function runGlobalConceptArticleAiEnrichmentBackfillV1(input?: {
  dryRun?: boolean;
  limit?: number;
  batchSize?: number;
}): Promise<GlobalConceptArticleAiEnrichmentBackfillSummaryV1> {
  const dryRun = input?.dryRun === true;
  const limit = Math.max(1, Math.min(input?.limit ?? DEFAULT_LIMIT, 50_000));
  const batchSize = Math.max(1, Math.min(input?.batchSize ?? DEFAULT_BATCH, 200));

  const summary: GlobalConceptArticleAiEnrichmentBackfillSummaryV1 = {
    dryRun,
    limit,
    batchSize,
    scanned: 0,
    applied: 0,
    dryRunEligible: 0,
    skippedDisabled: 0,
    skippedNotEligible: 0,
    skippedValidation: 0,
    skippedNoop: 0,
    skippedRace: 0,
    failed: 0,
  };

  const env = getEnv();
  if (
    !dryRun &&
    (!env.KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED || !env.KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED)
  ) {
    summary.skippedDisabled = limit;
    console.info("[global_concept_article_enrichment_backfill_skipped]", {
      reason: "FLAGS_DISABLED",
      articleEnabled: env.KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED,
      enrichmentEnabled: env.KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED,
    });
    return summary;
  }

  let afterId: string | null = null;

  while (summary.scanned < limit) {
    const take = Math.min(batchSize, limit - summary.scanned);
    if (take <= 0) break;

    const batch = await prisma.globalConceptArticle.findMany({
      where: {
        sourceType: "deterministic_seed_v1",
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: { id: true, globalConceptId: true },
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      if (summary.scanned >= limit) break;
      summary.scanned += 1;

      const outcome = await runGlobalConceptArticleAiEnrichmentForConceptV1({
        globalConceptId: row.globalConceptId,
        dryRun,
        logContext: { backfill: true, articleId: row.id },
      });

      switch (outcome) {
        case "applied":
          summary.applied += 1;
          break;
        case "dry_run":
          summary.dryRunEligible += 1;
          break;
        case "skipped_disabled":
          summary.skippedDisabled += 1;
          break;
        case "skipped_not_eligible":
          summary.skippedNotEligible += 1;
          break;
        case "skipped_validation":
          summary.skippedValidation += 1;
          break;
        case "skipped_noop":
          summary.skippedNoop += 1;
          break;
        case "skipped_race":
          summary.skippedRace += 1;
          break;
        case "failed":
          summary.failed += 1;
          break;
      }
    }

    afterId = batch[batch.length - 1]!.id;
    if (batch.length < take) break;
  }

  console.info("[global_concept_article_enrichment_backfill_summary]", summary);
  return summary;
}

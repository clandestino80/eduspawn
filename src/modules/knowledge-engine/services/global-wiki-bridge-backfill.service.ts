import * as knowledgeCategoryRepository from "../repositories/knowledge-category.repository";
import type { UpsertGlobalConceptRepositoryInput } from "../repositories/global-concept.repository";
import {
  deriveGlobalConceptUpsertInputFromCategoryTaxonomyV1,
  isCategoryTaxonomySufficientForGlobalBridgeV1,
  persistGlobalConceptLinkForKnowledgeCategoryV1,
} from "./global-wiki-bridge.service";

const DEFAULT_LIMIT = 10_000;
const DEFAULT_BATCH_SIZE = 200;

export type RunKnowledgeCategoryGlobalConceptBackfillV1Input = {
  /** When true, no GlobalConcept upsert and no category updates; still scans and counts. */
  dryRun?: boolean;
  /** Max category rows to examine (including skipped). */
  limit?: number;
  /** Rows per DB read (cursor by id asc). */
  batchSize?: number;
};

export type KnowledgeCategoryGlobalConceptBackfillSummaryV1 = {
  dryRun: boolean;
  limit: number;
  batchSize: number;
  /** Rows returned from DB queries (before per-row trim filter). */
  scanned: number;
  /** Rows with non-empty trimmed domain + subdomain. */
  eligible: number;
  /** Successful links (or dry-run: rows that would have been linked). */
  linked: number;
  /** Rows lacking taxonomy after trim (should be rare if SQL pre-filters). */
  skipped: number;
  /** Per-row errors (continues processing). */
  failed: number;
};

/**
 * Retroactively links KnowledgeCategory rows that have taxonomy but no globalConceptId,
 * using the same deterministic slug / upsert rules as the live Slice J bridge.
 *
 * Safe to run multiple times: only reads categories with globalConceptId null; successful
 * runs remove rows from the candidate set. Idempotent upsert on GlobalConcept.slug.
 */
export async function runKnowledgeCategoryGlobalConceptBackfillV1(
  input?: RunKnowledgeCategoryGlobalConceptBackfillV1Input,
): Promise<KnowledgeCategoryGlobalConceptBackfillSummaryV1> {
  const dryRun = input?.dryRun === true;
  const limit = Math.max(1, Math.min(input?.limit ?? DEFAULT_LIMIT, 500_000));
  const batchSize = Math.max(1, Math.min(input?.batchSize ?? DEFAULT_BATCH_SIZE, 5_000));

  const summary: KnowledgeCategoryGlobalConceptBackfillSummaryV1 = {
    dryRun,
    limit,
    batchSize,
    scanned: 0,
    eligible: 0,
    linked: 0,
    skipped: 0,
    failed: 0,
  };

  let afterId: string | null = null;

  while (summary.scanned < limit) {
    const take = Math.min(batchSize, limit - summary.scanned);
    if (take <= 0) break;

    const batch = await knowledgeCategoryRepository.findKnowledgeCategoriesPendingGlobalConceptLinkV1({
      afterId,
      take,
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      if (summary.scanned >= limit) break;

      summary.scanned += 1;

      if (
        !isCategoryTaxonomySufficientForGlobalBridgeV1({
          domain: row.domain,
          subdomain: row.subdomain,
        })
      ) {
        summary.skipped += 1;
        console.info("[global_wiki_bridge_backfill_row_skipped]", {
          categoryId: row.id,
          userId: row.userId,
          reason: "INSUFFICIENT_TAXONOMY_AFTER_TRIM",
        });
        continue;
      }

      summary.eligible += 1;

      const domain = row.domain!.trim();
      const subdomain = row.subdomain!.trim();
      const micro = row.microTopic?.trim() ?? null;
      const label = row.label ?? "";

      let fields: UpsertGlobalConceptRepositoryInput;
      try {
        fields = deriveGlobalConceptUpsertInputFromCategoryTaxonomyV1({
          domain,
          subdomain,
          microTopic: micro,
          label,
        });
      } catch (error) {
        summary.failed += 1;
        console.error("[global_wiki_bridge_backfill_row_failed]", {
          categoryId: row.id,
          userId: row.userId,
          stage: "derive_fields",
          error,
        });
        continue;
      }

      try {
        const result = await persistGlobalConceptLinkForKnowledgeCategoryV1({
          userId: row.userId,
          categoryId: row.id,
          fields,
          dryRun,
        });
        summary.linked += 1;
        const rowLog =
          result.dryRun === true
            ? { categoryId: row.id, userId: row.userId, slug: result.slug }
            : {
                categoryId: row.id,
                userId: row.userId,
                slug: result.slug,
                globalConceptId: result.globalConceptId,
              };
        console.info(
          dryRun ? "[global_wiki_bridge_backfill_row_dry_run]" : "[global_wiki_bridge_backfill_row_linked]",
          rowLog,
        );
      } catch (error) {
        summary.failed += 1;
        console.error("[global_wiki_bridge_backfill_row_failed]", {
          categoryId: row.id,
          userId: row.userId,
          stage: dryRun ? "dry_run_unexpected" : "persist",
          slug: fields.slug,
          error,
        });
      }
    }

    afterId = batch[batch.length - 1]!.id;

    if (batch.length < take) break;
  }

  console.info("[global_wiki_bridge_backfill_summary]", summary);
  return summary;
}

import { getEnv } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import type { UpsertGlobalConceptRepositoryInput } from "../repositories/global-concept.repository";
import { tryEnsureGlobalConceptArticleSeedV1 } from "./global-concept-article-seed.service";
import { runGlobalConceptArticleAiEnrichmentForConceptV1 } from "./global-concept-article-enrichment.service";

type RunGlobalConceptArticleAiEnrichment = typeof runGlobalConceptArticleAiEnrichmentForConceptV1;

/** Swappable entry to the enrichment pipeline (defaults to real implementation). */
let runGlobalConceptArticleAiEnrichmentForOps: RunGlobalConceptArticleAiEnrichment =
  runGlobalConceptArticleAiEnrichmentForConceptV1;

/**
 * Overrides the enrichment runner for automated tests; returns a disposer that restores the default.
 * Do not use from production request paths.
 */
export function setRunGlobalConceptArticleAiEnrichmentForOpsForTests(
  fn: RunGlobalConceptArticleAiEnrichment,
): () => void {
  const previous = runGlobalConceptArticleAiEnrichmentForOps;
  runGlobalConceptArticleAiEnrichmentForOps = fn;
  return () => {
    runGlobalConceptArticleAiEnrichmentForOps = previous;
  };
}

export type SingleConceptArticleEnrichOpsOutcomeCode =
  | "enriched"
  | "seeded_then_enriched"
  | "skipped_disabled"
  | "skipped_noop"
  | "skipped_not_eligible"
  | "skipped_validation"
  | "skipped_race"
  | "failed"
  | "not_found"
  | "dry_run";

export type SingleConceptArticleEnrichOpsResultV1 = {
  success: boolean;
  slug: string;
  dryRun: boolean;
  hadArticleBefore: boolean;
  articleSourceBefore: string | null;
  seededArticleThisRequest: boolean;
  enrichmentAttempted: boolean;
  outcome: SingleConceptArticleEnrichOpsOutcomeCode;
  message: string;
};

function toConceptFields(row: {
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
 * Authenticated ops entry: ensure seed (if missing) then run bounded AI enrichment for one concept by slug.
 * Reuses existing seed + enrichment pipelines; does not re-enrich rows already on ai_enriched_v1 (safety).
 *
 * Operator usage and outcome semantics: `backend/docs/runbooks/knowledge-engine-concept-enrich-ops.md`.
 * Structured logs for this path use prefix `[ke_ops]` (`event`: enrich_start | enrich_dry_run | enrich_complete).
 */
export async function runSingleConceptArticleEnrichmentBySlugForOpsV1(input: {
  slug: string;
  dryRun: boolean;
  logContext?: Record<string, unknown>;
}): Promise<SingleConceptArticleEnrichOpsResultV1> {
  const slug = input.slug.trim();
  const baseLog = {
    op: "concept_article_enrich",
    slug,
    dryRun: input.dryRun,
    trigger: "ops_single_enrich",
    ...input.logContext,
  };

  console.info("[ke_ops]", { event: "enrich_start", ...baseLog });

  const concept = await prisma.globalConcept.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      displayTitle: true,
      domain: true,
      subdomain: true,
      microTopic: true,
      mappingKey: true,
      article: { select: { id: true, sourceType: true } },
    },
  });

  if (!concept) {
    console.info("[ke_ops]", { event: "enrich_complete", ...baseLog, outcome: "not_found" });
    return {
      success: false,
      slug,
      dryRun: input.dryRun,
      hadArticleBefore: false,
      articleSourceBefore: null,
      seededArticleThisRequest: false,
      enrichmentAttempted: false,
      outcome: "not_found",
      message: "No GlobalConcept exists for this slug.",
    };
  }

  const hadArticleBefore = Boolean(concept.article);
  const articleSourceBefore = concept.article?.sourceType ?? null;

  if (input.dryRun === true) {
    if (!concept.article) {
      const fields = toConceptFields(concept);
      const wouldSeed = fields !== null && getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED;
      const wouldEnrich =
        getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED && getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED;
      console.info("[ke_ops]", {
        event: "enrich_dry_run",
        ...baseLog,
        wouldSeed,
        wouldEnrich,
        hasTaxonomyForSeed: fields !== null,
      });
      return {
        success: true,
        slug,
        dryRun: true,
        hadArticleBefore,
        articleSourceBefore,
        seededArticleThisRequest: false,
        enrichmentAttempted: false,
        outcome: "dry_run",
        message: wouldSeed
          ? "Would create deterministic seed (if missing) then run enrichment when flags allow."
          : fields === null
            ? "Would skip: concept taxonomy is insufficient to build a deterministic seed."
            : "Would run enrichment on existing deterministic article when flags allow.",
      };
    }
    if (concept.article.sourceType === "ai_enriched_v1") {
      console.info("[ke_ops]", { event: "enrich_dry_run", ...baseLog, wouldSkip: "already_enriched" });
      return {
        success: true,
        slug,
        dryRun: true,
        hadArticleBefore,
        articleSourceBefore,
        seededArticleThisRequest: false,
        enrichmentAttempted: false,
        outcome: "dry_run",
        message: "Would skip: article is already enriched; re-run is not supported on this path.",
      };
    }
    const dryEnrich = await runGlobalConceptArticleAiEnrichmentForOps({
      globalConceptId: concept.id,
      dryRun: true,
      quietDryRunLog: true,
      logContext: baseLog,
    });
    console.info("[ke_ops]", { event: "enrich_dry_run", ...baseLog, probe: dryEnrich });
    return {
      success: true,
      slug,
      dryRun: true,
      hadArticleBefore,
      articleSourceBefore,
      seededArticleThisRequest: false,
      enrichmentAttempted: true,
      outcome: "dry_run",
      message:
        dryEnrich === "dry_run"
          ? "Would run AI enrichment on deterministic article when flags allow."
          : `Dry-run enrichment probe returned: ${dryEnrich}.`,
    };
  }

  if (!getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED) {
    console.info("[ke_ops]", { event: "enrich_complete", ...baseLog, outcome: "skipped_disabled", reason: "ARTICLE" });
    return {
      success: true,
      slug,
      dryRun: false,
      hadArticleBefore,
      articleSourceBefore,
      seededArticleThisRequest: false,
      enrichmentAttempted: false,
      outcome: "skipped_disabled",
      message: "Global concept articles are disabled (KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED).",
    };
  }

  if (!getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED) {
    console.info("[ke_ops]", {
      event: "enrich_complete",
      ...baseLog,
      outcome: "skipped_disabled",
      reason: "ENRICHMENT",
    });
    return {
      success: true,
      slug,
      dryRun: false,
      hadArticleBefore,
      articleSourceBefore,
      seededArticleThisRequest: false,
      enrichmentAttempted: false,
      outcome: "skipped_disabled",
      message: "Article enrichment is disabled (KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED).",
    };
  }

  if (concept.article?.sourceType === "ai_enriched_v1") {
    console.info("[ke_ops]", { event: "enrich_complete", ...baseLog, outcome: "skipped_not_eligible" });
    return {
      success: true,
      slug,
      dryRun: false,
      hadArticleBefore,
      articleSourceBefore,
      seededArticleThisRequest: false,
      enrichmentAttempted: false,
      outcome: "skipped_not_eligible",
      message: "Article is already AI-enriched; this ops path does not reset or overwrite enriched rows.",
    };
  }

  const conceptFields = toConceptFields(concept);
  let seededArticleThisRequest = false;

  if (!concept.article) {
    if (!conceptFields) {
      console.info("[ke_ops]", { event: "enrich_complete", ...baseLog, outcome: "skipped_not_eligible", reason: "taxonomy" });
      return {
        success: true,
        slug,
        dryRun: false,
        hadArticleBefore: false,
        articleSourceBefore: null,
        seededArticleThisRequest: false,
        enrichmentAttempted: false,
        outcome: "skipped_not_eligible",
        message: "Cannot seed article: domain and subdomain are required on the GlobalConcept row.",
      };
    }
    const seedOutcome = await tryEnsureGlobalConceptArticleSeedV1({
      globalConceptId: concept.id,
      conceptFields,
      skipAiEnrichment: true,
      logContext: { ...baseLog, stage: "ops_seed_before_enrich" },
    });
    if (seedOutcome === "skipped_disabled") {
      console.info("[ke_ops]", { event: "enrich_complete", ...baseLog, outcome: "skipped_disabled", reason: "seed_flags" });
      return {
        success: true,
        slug,
        dryRun: false,
        hadArticleBefore: false,
        articleSourceBefore: null,
        seededArticleThisRequest: false,
        enrichmentAttempted: false,
        outcome: "skipped_disabled",
        message: "Article seed skipped (article feature disabled during seed).",
      };
    }
    if (seedOutcome === "failed") {
      console.error("[ke_ops]", { event: "enrich_complete", ...baseLog, outcome: "failed", stage: "seed" });
      return {
        success: false,
        slug,
        dryRun: false,
        hadArticleBefore: false,
        articleSourceBefore: null,
        seededArticleThisRequest: false,
        enrichmentAttempted: false,
        outcome: "failed",
        message: "Deterministic article seed failed.",
      };
    }
    if (seedOutcome === "skipped_preserved_enriched") {
      console.info("[ke_ops]", { event: "enrich_complete", ...baseLog, outcome: "skipped_not_eligible", reason: "preserved_enriched" });
      return {
        success: true,
        slug,
        dryRun: false,
        hadArticleBefore: true,
        articleSourceBefore: "ai_enriched_v1",
        seededArticleThisRequest: false,
        enrichmentAttempted: false,
        outcome: "skipped_not_eligible",
        message: "Article already exists as enriched content; single-path re-enrich is not supported.",
      };
    }
    seededArticleThisRequest = seedOutcome === "upserted";
  }

  const enrich = await runGlobalConceptArticleAiEnrichmentForOps({
    globalConceptId: concept.id,
    dryRun: false,
    logContext: baseLog,
  });

  const enrichmentAttempted = true;

  if (enrich === "applied") {
    const outcome: SingleConceptArticleEnrichOpsOutcomeCode = seededArticleThisRequest
      ? "seeded_then_enriched"
      : "enriched";
    console.info("[ke_ops]", { event: "enrich_complete", ...baseLog, outcome });
    return {
      success: true,
      slug,
      dryRun: false,
      hadArticleBefore,
      articleSourceBefore,
      seededArticleThisRequest,
      enrichmentAttempted,
      outcome,
      message: seededArticleThisRequest
        ? "Created deterministic seed and applied AI enrichment."
        : "Applied AI enrichment to deterministic article.",
    };
  }

  const messageByEnrich: Record<string, string> = {
    skipped_disabled: "Enrichment was skipped (flags).",
    skipped_not_eligible: "Enrichment not eligible (e.g. article not deterministic seed or missing row).",
    skipped_validation: "Enrichment failed validation; article unchanged.",
    skipped_noop: "Enrichment produced no effective change; article unchanged.",
    skipped_race: "Enrichment did not apply (race or row no longer deterministic).",
    failed: "Enrichment failed with an error; see server logs.",
  };

  const outcome =
    enrich === "skipped_disabled"
      ? "skipped_disabled"
      : enrich === "skipped_not_eligible"
        ? "skipped_not_eligible"
        : enrich === "skipped_validation"
          ? "skipped_validation"
          : enrich === "skipped_noop"
            ? "skipped_noop"
            : enrich === "skipped_race"
              ? "skipped_race"
              : "failed";

  console.info("[ke_ops]", { event: "enrich_complete", ...baseLog, outcome });

  return {
    success: enrich !== "failed",
    slug,
    dryRun: false,
    hadArticleBefore,
    articleSourceBefore,
    seededArticleThisRequest,
    enrichmentAttempted,
    outcome,
    message: messageByEnrich[enrich] ?? messageByEnrich.failed,
  };
}

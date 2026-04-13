import type { Prisma } from "@prisma/client";
import { getEnv } from "../../../config/env";
import type { UpsertGlobalConceptRepositoryInput } from "../repositories/global-concept.repository";
import * as globalConceptArticleRepository from "../repositories/global-concept-article.repository";
import { scheduleGlobalConceptArticleAiEnrichmentAfterCreateV1 } from "./global-concept-article-enrichment.service";

const SUMMARY_MAX = 4000;
const HOOK_MAX = 500;

function humanizeTaxonomyPart(slug: string): string {
  const t = slug.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : slug;
}

/**
 * Deterministic reusable article seed from GlobalConcept taxonomy fields (no LLM).
 */
export function buildDeterministicGlobalConceptArticleSeedV1(
  fields: UpsertGlobalConceptRepositoryInput,
): {
  schemaVersion: number;
  summary: string;
  hook: string;
  relatedQuestionsJson: Prisma.InputJsonValue;
  sourceType: string;
} {
  const title = fields.displayTitle.trim();
  const d = humanizeTaxonomyPart(fields.domain.trim());
  const s = humanizeTaxonomyPart(fields.subdomain.trim());
  const m =
    fields.microTopic && fields.microTopic.trim().length > 0
      ? humanizeTaxonomyPart(fields.microTopic.trim())
      : "";
  const theme = m.length > 0 ? `${d} · ${s} · ${m}` : `${d} · ${s}`;

  const summary = [
    title,
    "",
    `This shared concept in EduSpawn groups learning activity around: ${theme}.`,
    "This record is an automated seed for navigation and future richer articles; it is not a full wiki page.",
  ]
    .join("\n")
    .slice(0, SUMMARY_MAX);

  const hook = `Explore this cross-learner thread: ${title} (${theme}).`.slice(0, HOOK_MAX);

  const relatedQuestions = [
    `What ideas fit under ${d} and ${s}?`,
    `What should I study next within “${title.slice(0, 120)}”?`,
    "How does this theme connect to ideas I already saved?",
  ];

  return {
    schemaVersion: 1,
    summary,
    hook,
    relatedQuestionsJson: relatedQuestions,
    sourceType: "deterministic_seed_v1",
  };
}

export type GlobalConceptArticleSeedOutcomeV1 =
  | "upserted"
  | "skipped_disabled"
  | "skipped_preserved_enriched"
  | "failed";

/**
 * Ensures a GlobalConceptArticle seed exists after a GlobalConcept upsert. Never throws.
 * Runs after category link in the bridge path so Personal Brain linking is never blocked by articles.
 */
export async function tryEnsureGlobalConceptArticleSeedV1(input: {
  globalConceptId: string;
  conceptFields: UpsertGlobalConceptRepositoryInput;
  logContext?: Record<string, unknown>;
  /** Ops seed backfill: avoid firing many concurrent AI jobs (default false). */
  skipAiEnrichment?: boolean;
}): Promise<GlobalConceptArticleSeedOutcomeV1> {
  const baseLog = {
    globalConceptId: input.globalConceptId,
    slug: input.conceptFields.slug,
    ...input.logContext,
  };

  try {
    if (!getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED) {
      console.info("[global_concept_article_skipped]", { ...baseLog, reason: "GLOBAL_CONCEPT_ARTICLE_DISABLED" });
      return "skipped_disabled";
    }

    const prior = await globalConceptArticleRepository.findGlobalConceptArticleBriefByConceptId(
      input.globalConceptId,
    );
    if (prior && prior.sourceType === "ai_enriched_v1") {
      console.info("[global_concept_article_skipped]", {
        ...baseLog,
        reason: "PRESERVED_ENRICHED_ARTICLE",
        articleId: prior.id,
      });
      return "skipped_preserved_enriched";
    }

    const wasMissing = prior === null;

    const seed = buildDeterministicGlobalConceptArticleSeedV1(input.conceptFields);
    const row = await globalConceptArticleRepository.upsertGlobalConceptArticleSeedV1({
      globalConceptId: input.globalConceptId,
      schemaVersion: seed.schemaVersion,
      summary: seed.summary,
      hook: seed.hook,
      relatedQuestionsJson: seed.relatedQuestionsJson,
      sourceType: seed.sourceType,
    });

    console.info("[global_concept_article_upserted]", {
      ...baseLog,
      articleId: row.id,
      sourceType: seed.sourceType,
      schemaVersion: seed.schemaVersion,
    });

    if (
      wasMissing &&
      input.skipAiEnrichment !== true &&
      getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED &&
      getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED
    ) {
      scheduleGlobalConceptArticleAiEnrichmentAfterCreateV1({
        globalConceptId: input.globalConceptId,
        logContext: baseLog,
      });
    }

    return "upserted";
  } catch (error) {
    console.error("[global_concept_article_error]", { ...baseLog, error });
    return "failed";
  }
}

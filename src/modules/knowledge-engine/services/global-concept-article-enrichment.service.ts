import type { Prisma } from "@prisma/client";
import { getEnv } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import { runAiTask } from "../../ai/router/model-router.service";
import type { PlanTier } from "../../ai/providers/ai-provider.types";
import {
  globalConceptArticleEnrichmentAiSchema,
  type GlobalConceptArticleEnrichmentAi,
} from "../schemas/global-concept-article-enrichment.schema";
import * as globalConceptArticleRepository from "../repositories/global-concept-article.repository";

const ENRICHED_SOURCE_TYPE = "ai_enriched_v1";
const DETERMINISTIC_SOURCE_TYPE = "deterministic_seed_v1";

function parseAiJson(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function normalizePlanTierForInternalJob(): PlanTier {
  const raw = process.env.DEFAULT_PLAN_TIER?.trim().toLowerCase();
  if (raw === "pro" || raw === "premium") return raw;
  return "free";
}

function relatedQuestionsFromJson(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function summaryLooksLikeMarkdownBlob(text: string): boolean {
  if (text.includes("```")) return true;
  const lines = text.split(/\r?\n/);
  if (lines.length > 22) return true;
  const headingish = lines.filter((l) => /^#{1,6}\s+\S/.test(l.trim())).length;
  return headingish > 2;
}

function mergeEnrichmentWithExisting(input: {
  existingSummary: string;
  existingHook: string | null;
  existingQuestions: string[];
  ai: GlobalConceptArticleEnrichmentAi;
}): { summary: string; hook: string | null; relatedQuestions: string[] } | null {
  const nextSummary = summaryLooksLikeMarkdownBlob(input.ai.summary) ? input.existingSummary : input.ai.summary;
  const nextHook = input.ai.hook;
  const nextQuestions = input.ai.relatedQuestions;

  const summaryChanged = nextSummary.trim() !== input.existingSummary.trim();
  const hookChanged = (nextHook ?? "").trim() !== (input.existingHook ?? "").trim();
  const eqQuestions =
    nextQuestions.length === input.existingQuestions.length &&
    nextQuestions.every((q, i) => q === input.existingQuestions[i]);
  const questionsChanged = !eqQuestions;

  if (!summaryChanged && !hookChanged && !questionsChanged) {
    return null;
  }

  return {
    summary: summaryChanged ? nextSummary : input.existingSummary,
    hook: hookChanged ? nextHook : input.existingHook,
    relatedQuestions: questionsChanged ? nextQuestions : input.existingQuestions,
  };
}

function buildEnrichmentPrompt(input: {
  displayTitle: string;
  domain: string | null;
  subdomain: string | null;
  microTopic: string | null;
  seedSummary: string;
  seedHook: string | null;
  seedQuestions: string[];
}): string {
  const theme = [input.domain, input.subdomain, input.microTopic].filter(Boolean).join(" / ") || "(taxonomy n/a)";
  return `Global concept (shared, cross-learner thread):
- displayTitle: ${input.displayTitle}
- taxonomy theme: ${theme}

Current deterministic seed (must be improved, not discarded without cause):
--- summary ---
${input.seedSummary}
--- hook ---
${input.seedHook ?? ""}
--- relatedQuestions (strings) ---
${JSON.stringify(input.seedQuestions)}

Return ONLY JSON with keys: hook, summary, relatedQuestions.
Rules:
- Plain sentences only: no markdown, no code fences, no headings, no wiki sections.
- summary: 80–3200 chars, 2–16 short paragraphs or lines; concise, reusable teaching overview for many learners.
- hook: 12–420 chars; one inviting line.
- relatedQuestions: 3–6 strings, each 8–220 chars; curiosity prompts, not quiz stems.
- Stay factual and general; do not invent personal data or learner-specific claims.`;
}

/**
 * Bounded AI pass to improve hook/summary/relatedQuestions for a deterministic GlobalConceptArticle.
 * Soft-failing: never throws to callers; logs outcomes.
 */
export async function runGlobalConceptArticleAiEnrichmentForConceptV1(input: {
  globalConceptId: string;
  dryRun?: boolean;
  /** When true with dryRun, skips the inner dry-run console line (caller logs a single ops-level line). */
  quietDryRunLog?: boolean;
  logContext?: Record<string, unknown>;
}): Promise<
  | "applied"
  | "dry_run"
  | "skipped_disabled"
  | "skipped_not_eligible"
  | "skipped_validation"
  | "skipped_noop"
  | "skipped_race"
  | "failed"
> {
  const baseLog = { globalConceptId: input.globalConceptId, ...input.logContext };

  try {
    const row = await prisma.globalConcept.findUnique({
      where: { id: input.globalConceptId },
      select: {
        id: true,
        slug: true,
        displayTitle: true,
        domain: true,
        subdomain: true,
        microTopic: true,
        article: {
          select: {
            id: true,
            sourceType: true,
            summary: true,
            hook: true,
            relatedQuestionsJson: true,
          },
        },
      },
    });

    if (!row?.article) {
      console.info("[global_concept_article_enrichment_skipped]", { ...baseLog, reason: "NO_ARTICLE_ROW" });
      return "skipped_not_eligible";
    }
    if (row.article.sourceType !== DETERMINISTIC_SOURCE_TYPE) {
      console.info("[global_concept_article_enrichment_skipped]", {
        ...baseLog,
        reason: "NOT_DETERMINISTIC_SEED",
        sourceType: row.article.sourceType,
      });
      return "skipped_not_eligible";
    }

    const seedQuestions = relatedQuestionsFromJson(row.article.relatedQuestionsJson);
    if (input.dryRun === true) {
      if (input.quietDryRunLog !== true) {
        console.info("[global_concept_article_enrichment_dry_run]", { ...baseLog, slug: row.slug });
      }
      return "dry_run";
    }

    if (!getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED) {
      console.info("[global_concept_article_enrichment_skipped]", { ...baseLog, reason: "ARTICLE_DISABLED" });
      return "skipped_disabled";
    }
    if (!getEnv().KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED) {
      console.info("[global_concept_article_enrichment_skipped]", { ...baseLog, reason: "ENRICHMENT_DISABLED" });
      return "skipped_disabled";
    }

    const planTier = normalizePlanTierForInternalJob();
    const output = await runAiTask({
      taskType: "global_concept_article_enrichment",
      planTier,
      responseFormat: "json",
      messages: [
        {
          role: "system",
          content:
            "You improve short reusable concept articles for EduSpawn. Output MUST be a single JSON object only. No markdown.",
        },
        {
          role: "user",
          content: buildEnrichmentPrompt({
            displayTitle: row.displayTitle,
            domain: row.domain,
            subdomain: row.subdomain,
            microTopic: row.microTopic,
            seedSummary: row.article.summary,
            seedHook: row.article.hook,
            seedQuestions: seedQuestions.length > 0 ? seedQuestions : ["What connects here?", "What should I explore next?", "How does this theme show up in practice?"],
          }),
        },
      ],
      metadata: {
        stage: "global_concept_article_enrichment",
        globalConceptId: input.globalConceptId,
        slug: row.slug,
      },
    });

    const parsedObj = parseAiJson(output.content);
    if (!parsedObj) {
      console.warn("[global_concept_article_enrichment_failed]", { ...baseLog, reason: "JSON_PARSE" });
      return "skipped_validation";
    }

    const validated = globalConceptArticleEnrichmentAiSchema.safeParse(parsedObj);
    if (!validated.success) {
      console.warn("[global_concept_article_enrichment_failed]", {
        ...baseLog,
        reason: "ZOD_VALIDATION",
        detail: validated.error.flatten(),
      });
      return "skipped_validation";
    }

    const merged = mergeEnrichmentWithExisting({
      existingSummary: row.article.summary,
      existingHook: row.article.hook,
      existingQuestions: seedQuestions,
      ai: validated.data,
    });
    if (!merged) {
      console.info("[global_concept_article_enrichment_skipped]", { ...baseLog, reason: "NO_EFFECTIVE_CHANGE" });
      return "skipped_noop";
    }

    const provenance: Prisma.InputJsonValue = {
      schemaVersion: 1,
      seedSourceType: DETERMINISTIC_SOURCE_TYPE,
      enrichedAt: new Date().toISOString(),
      provider: output.provider,
      model: output.model,
      planTier,
      finishReason: output.finishReason,
    };

    const relatedJson: Prisma.InputJsonValue = merged.relatedQuestions;

    const { updated } = await globalConceptArticleRepository.applyGlobalConceptArticleAiEnrichmentV1({
      globalConceptId: input.globalConceptId,
      summary: merged.summary,
      hook: merged.hook,
      relatedQuestionsJson: relatedJson,
      sourceType: ENRICHED_SOURCE_TYPE,
      enrichmentProvenanceJson: provenance,
    });

    if (updated === 0) {
      console.info("[global_concept_article_enrichment_skipped]", { ...baseLog, reason: "RACE_OR_ALREADY_ENRICHED" });
      return "skipped_race";
    }

    console.info("[global_concept_article_enrichment_applied]", {
      ...baseLog,
      slug: row.slug,
      provider: output.provider,
      model: output.model,
    });
    return "applied";
  } catch (error) {
    console.error("[global_concept_article_enrichment_error]", { ...baseLog, error });
    return "failed";
  }
}

/**
 * Fire-and-forget safe wrapper after first-time deterministic article create.
 */
export function scheduleGlobalConceptArticleAiEnrichmentAfterCreateV1(input: {
  globalConceptId: string;
  logContext?: Record<string, unknown>;
}): void {
  void runGlobalConceptArticleAiEnrichmentForConceptV1({
    globalConceptId: input.globalConceptId,
    dryRun: false,
    logContext: { ...input.logContext, trigger: "post_create" },
  }).catch(() => {
    /* logged inside */
  });
}

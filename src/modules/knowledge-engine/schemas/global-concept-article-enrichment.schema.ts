import { z } from "zod";

/**
 * Strict model output for GlobalConceptArticle AI enrichment (bounded, no markdown wiki).
 */
export const globalConceptArticleEnrichmentAiSchema = z
  .object({
    hook: z.string().trim().min(12).max(420),
    summary: z.string().trim().min(80).max(3400),
    relatedQuestions: z.array(z.string().trim().min(8).max(220)).min(3).max(6),
  })
  .strict();

export type GlobalConceptArticleEnrichmentAi = z.infer<typeof globalConceptArticleEnrichmentAiSchema>;

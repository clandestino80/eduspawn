import { withReadDbRetry } from "../../../lib/read-with-db-retry";
import type { GlobalConceptRowWithArticleAndCategoryCount } from "../repositories/global-concept-read.repository";
import * as globalConceptReadRepository from "../repositories/global-concept-read.repository";

function normalizeRelatedQuestions(json: unknown): string[] | null {
  if (!Array.isArray(json)) return null;
  const out = json.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return out.length > 0 ? out : null;
}

export type GlobalConceptArticleReadDto = {
  hasArticle: boolean;
  summary: string | null;
  hook: string | null;
  relatedQuestions: string[] | null;
  sourceType: string | null;
  schemaVersion: number | null;
};

export type GlobalConceptReadDto = {
  slug: string;
  displayTitle: string;
  domain: string | null;
  subdomain: string | null;
  microTopic: string | null;
  createdAt: string;
  updatedAt: string;
  article: GlobalConceptArticleReadDto;
  stats: {
    linkedCategoriesCount: number;
    linkedKnowledgeNodesCount?: number;
  };
};

function mapArticle(row: GlobalConceptRowWithArticleAndCategoryCount): GlobalConceptArticleReadDto {
  const a = row.article;
  if (!a) {
    return {
      hasArticle: false,
      summary: null,
      hook: null,
      relatedQuestions: null,
      sourceType: null,
      schemaVersion: null,
    };
  }
  return {
    hasArticle: true,
    summary: a.summary,
    hook: a.hook,
    relatedQuestions: normalizeRelatedQuestions(a.relatedQuestionsJson),
    sourceType: a.sourceType,
    schemaVersion: a.schemaVersion,
  };
}

function mapRow(
  row: GlobalConceptRowWithArticleAndCategoryCount,
  opts: { includeNodeCount: boolean; nodesLinked?: number },
): GlobalConceptReadDto {
  const dto: GlobalConceptReadDto = {
    slug: row.slug,
    displayTitle: row.displayTitle,
    domain: row.domain,
    subdomain: row.subdomain,
    microTopic: row.microTopic,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    article: mapArticle(row),
    stats: {
      linkedCategoriesCount: row._count.categories,
    },
  };
  if (opts.includeNodeCount && typeof opts.nodesLinked === "number") {
    dto.stats.linkedKnowledgeNodesCount = opts.nodesLinked;
  }
  return dto;
}

export async function getGlobalConceptBySlugForReadApi(slug: string): Promise<GlobalConceptReadDto | null> {
  const row = await withReadDbRetry(
    "global_concept_read_by_slug",
    () => globalConceptReadRepository.findGlobalConceptBySlugForRead(slug),
    { slug },
  );
  if (!row) return null;

  const nodesLinked = await withReadDbRetry(
    "global_concept_read_node_count",
    () => globalConceptReadRepository.countKnowledgeNodesLinkedToGlobalConcept(row.id),
    { globalConceptId: row.id },
  );

  return mapRow(row, { includeNodeCount: true, nodesLinked });
}

export async function listGlobalConceptsForReadApi(input: {
  limit: number;
  domain?: string;
  subdomain?: string;
}): Promise<GlobalConceptReadDto[]> {
  const repositoryInput: { take: number; domain?: string; subdomain?: string } = { take: input.limit };
  if (input.domain !== undefined) repositoryInput.domain = input.domain;
  if (input.subdomain !== undefined) repositoryInput.subdomain = input.subdomain;
  const rows = await withReadDbRetry(
    "global_concept_read_list",
    () => globalConceptReadRepository.findGlobalConceptsForReadList(repositoryInput),
    { limit: input.limit, domain: input.domain ?? null, subdomain: input.subdomain ?? null },
  );
  return rows.map((r) => mapRow(r, { includeNodeCount: false }));
}

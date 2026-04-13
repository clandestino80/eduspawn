import { createHash } from "node:crypto";
import { getEnv } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import * as globalConceptRepository from "../repositories/global-concept.repository";
import type { UpsertGlobalConceptRepositoryInput } from "../repositories/global-concept.repository";
import { tryEnsureGlobalConceptArticleSeedV1 } from "./global-concept-article-seed.service";

const SLUG_MAX = 190;
const DISPLAY_TITLE_MAX = 220;

function slugifySegment(text: string, max: number): string {
  const raw = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return raw.length > 0 ? raw : "none";
}

function humanizeSlugSegment(slug: string): string {
  const t = slug.replace(/-/g, " ").trim();
  return t.length > 0 ? t : slug;
}

/**
 * Deterministic global slug from Category Engine V2 taxonomy fields (aligned with mapLessonSignalsToTaxonomyV1).
 */
export function buildGlobalConceptSlugV1(
  domain: string,
  subdomain: string,
  microTopic: string | null | undefined,
): string {
  const d = slugifySegment(domain.trim(), 48);
  const s = slugifySegment(subdomain.trim(), 64);
  const m =
    microTopic && microTopic.trim().length > 0
      ? slugifySegment(microTopic.trim(), 96)
      : "none";
  const base = `v1:gc:${d}:${s}:${m}`;
  return base.slice(0, SLUG_MAX);
}

function buildMappingKeyV1(domain: string, subdomain: string, micro: string | null): string {
  const payload = `v1|${domain.trim()}|${subdomain.trim()}|${micro ?? ""}`;
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 32);
}

function buildDisplayTitleV1(input: {
  domain: string;
  subdomain: string;
  microTopic: string | null;
  categoryLabel: string;
}): string {
  const d = humanizeSlugSegment(slugifySegment(input.domain.trim(), 48));
  const s = humanizeSlugSegment(slugifySegment(input.subdomain.trim(), 64));
  const m =
    input.microTopic && input.microTopic.trim().length > 0
      ? humanizeSlugSegment(slugifySegment(input.microTopic.trim(), 96))
      : null;
  const taxonomyLine = m ? `${d} / ${s} / ${m}` : `${d} / ${s}`;
  const label = input.categoryLabel.replace(/\s+/g, " ").trim();
  if (label.length > 0) {
    const combined = `${label} — ${taxonomyLine}`;
    return combined.length <= DISPLAY_TITLE_MAX
      ? combined
      : combined.slice(0, DISPLAY_TITLE_MAX);
  }
  return taxonomyLine.slice(0, DISPLAY_TITLE_MAX);
}

export type CategoryTaxonomySnapshotForGlobalBridgeV1 = {
  domain: string | null | undefined;
  subdomain: string | null | undefined;
};

export function isCategoryTaxonomySufficientForGlobalBridgeV1(
  cat: CategoryTaxonomySnapshotForGlobalBridgeV1,
): boolean {
  const domain = cat.domain?.trim() ?? "";
  const subdomain = cat.subdomain?.trim() ?? "";
  return domain.length > 0 && subdomain.length > 0;
}

export type CategoryFieldsForGlobalConceptDeriveV1 = {
  domain: string;
  subdomain: string;
  microTopic: string | null;
  label: string;
};

/**
 * Shared deterministic mapping: taxonomy + label → GlobalConcept upsert payload (Slice J).
 */
export function deriveGlobalConceptUpsertInputFromCategoryTaxonomyV1(
  cat: CategoryFieldsForGlobalConceptDeriveV1,
): UpsertGlobalConceptRepositoryInput {
  const domain = cat.domain.trim();
  const subdomain = cat.subdomain.trim();
  const micro = cat.microTopic?.trim() ?? null;
  const slug = buildGlobalConceptSlugV1(domain, subdomain, micro);
  const mappingKey = buildMappingKeyV1(domain, subdomain, micro);
  const displayTitle = buildDisplayTitleV1({
    domain,
    subdomain,
    microTopic: micro,
    categoryLabel: cat.label,
  });
  return {
    slug,
    displayTitle,
    domain,
    subdomain,
    microTopic: micro,
    mappingKey,
  };
}

export type PersistGlobalConceptLinkForKnowledgeCategoryV1Input = {
  userId: string;
  categoryId: string;
  fields: UpsertGlobalConceptRepositoryInput;
  dryRun?: boolean;
};

export type PersistGlobalConceptLinkForKnowledgeCategoryV1Result =
  | { slug: string; globalConceptId: string; dryRun: false }
  | { slug: string; dryRun: true };

/**
 * Upsert GlobalConcept by slug and set KnowledgeCategory.globalConceptId (idempotent).
 * When dryRun is true, performs no database writes (for operational previews).
 */
export async function persistGlobalConceptLinkForKnowledgeCategoryV1(
  input: PersistGlobalConceptLinkForKnowledgeCategoryV1Input,
): Promise<PersistGlobalConceptLinkForKnowledgeCategoryV1Result> {
  if (input.dryRun === true) {
    return { slug: input.fields.slug, dryRun: true };
  }

  const global = await globalConceptRepository.upsertGlobalConceptBySlug(input.fields);
  await prisma.knowledgeCategory.updateMany({
    where: { id: input.categoryId, userId: input.userId },
    data: { globalConceptId: global.id },
  });
  await tryEnsureGlobalConceptArticleSeedV1({
    globalConceptId: global.id,
    conceptFields: input.fields,
    logContext: { userId: input.userId, categoryId: input.categoryId },
  });
  return { slug: input.fields.slug, globalConceptId: global.id, dryRun: false };
}

/**
 * Slice J — after taxonomy is written: upsert GlobalConcept and attach to the user's category.
 * Soft-fail: never throws; logs success/skip/failure for ops.
 */
export async function tryBridgeKnowledgeCategoryToGlobalConceptV1(input: {
  userId: string;
  categoryId: string;
  sessionId?: string;
  stage: "persist_lesson" | "extract_atoms";
}): Promise<void> {
  const baseLog = {
    stage: input.stage,
    userId: input.userId,
    categoryId: input.categoryId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };

  try {
    if (!getEnv().KNOWLEDGE_ENGINE_ENABLED) {
      console.info("[global_wiki_bridge_skipped]", { ...baseLog, reason: "KNOWLEDGE_ENGINE_DISABLED" });
      return;
    }
    if (!getEnv().KNOWLEDGE_GLOBAL_WIKI_BRIDGE_ENABLED) {
      console.info("[global_wiki_bridge_skipped]", { ...baseLog, reason: "GLOBAL_WIKI_BRIDGE_DISABLED" });
      return;
    }

    const cat = await prisma.knowledgeCategory.findFirst({
      where: { id: input.categoryId, userId: input.userId },
      select: {
        domain: true,
        subdomain: true,
        microTopic: true,
        label: true,
        globalConceptId: true,
      },
    });

    if (!cat) {
      console.warn("[global_wiki_bridge_skipped]", { ...baseLog, reason: "CATEGORY_NOT_FOUND" });
      return;
    }

    if (!isCategoryTaxonomySufficientForGlobalBridgeV1(cat)) {
      console.info("[global_wiki_bridge_skipped]", {
        ...baseLog,
        reason: "INSUFFICIENT_TAXONOMY",
        domainPresent: (cat.domain?.trim().length ?? 0) > 0,
        subdomainPresent: (cat.subdomain?.trim().length ?? 0) > 0,
      });
      return;
    }

    const domain = cat.domain!.trim();
    const subdomain = cat.subdomain!.trim();
    const micro = cat.microTopic?.trim() ?? null;
    const fields = deriveGlobalConceptUpsertInputFromCategoryTaxonomyV1({
      domain,
      subdomain,
      microTopic: micro,
      label: cat.label,
    });

    const result = await persistGlobalConceptLinkForKnowledgeCategoryV1({
      userId: input.userId,
      categoryId: input.categoryId,
      fields,
      dryRun: false,
    });
    if (result.dryRun) {
      return;
    }

    console.info("[global_wiki_bridge_linked]", {
      ...baseLog,
      globalConceptId: result.globalConceptId,
      slug: result.slug,
      mappingKey: fields.mappingKey,
      priorCategoryLinkId: cat.globalConceptId,
    });
  } catch (error) {
    console.error("[global_wiki_bridge_error]", { ...baseLog, error });
  }
}

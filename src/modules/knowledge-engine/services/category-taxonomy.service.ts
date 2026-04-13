/**
 * Slice H — deterministic Category Engine V2 (no LLM).
 * Maps lesson signals into coarse domain / subdomain / micro-topic strings for KnowledgeCategory rows.
 * Unknown layers are omitted from the patch (no fabricated precision).
 */

import * as knowledgeCategoryRepository from "../repositories/knowledge-category.repository";

const MAX_DOMAIN = 48;
const MAX_SUBDOMAIN = 64;
const MAX_MICRO = 96;
const MAX_INTENT = 220;
const MIN_WORD_LEN = 3;

export type CategoryTaxonomyV1Patch = {
  domain?: string;
  subdomain?: string;
  microTopic?: string;
  difficultySignal?: string;
  formatAffinity?: string;
  intentHint?: string;
};

function slugifySegment(text: string, max: number): string {
  const raw = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return raw.length > 0 ? raw : "uncategorized";
}

function tokenizeWords(text: string): string[] {
  const m = text.normalize("NFKC").match(/[\p{L}\p{N}]+/gu);
  if (!m) return [];
  return m.map((w) => w.toLowerCase()).filter((w) => w.length >= MIN_WORD_LEN);
}

/**
 * Primary coarse bucket for retrieval / DNA (same slug rules as domain on categories).
 */
export function inferDomainBucketFromTopic(topic: string): string {
  const words = tokenizeWords(topic.trim());
  const domain = words[0] ?? "exploration";
  return slugifySegment(domain, MAX_DOMAIN);
}

/**
 * Deterministic taxonomy from topic, curiosity, optional difficulty, and optional atom titles.
 * Only includes fields we can derive without guessing fine-grained ontology.
 */
export function mapLessonSignalsToTaxonomyV1(input: {
  topic: string;
  curiosityPrompt: string;
  sessionDifficulty?: string | null | undefined;
  atomTitles?: readonly string[] | undefined;
}): CategoryTaxonomyV1Patch {
  const topicTrim = input.topic.trim();
  const curiosityTrim = input.curiosityPrompt.trim();
  const words = tokenizeWords(topicTrim.length > 0 ? topicTrim : curiosityTrim);

  const domain = inferDomainBucketFromTopic(topicTrim.length > 0 ? topicTrim : curiosityTrim);

  const subdomainSource =
    words.length >= 2
      ? words.slice(1, 4).join("-")
      : words.length === 1
        ? `${words[0]}-thread`
        : "general-thread";
  const subdomain = slugifySegment(subdomainSource, MAX_SUBDOMAIN);

  let microSource = "";
  if (curiosityTrim.length >= 18) {
    microSource = curiosityTrim.slice(0, 140);
  } else if (input.atomTitles && input.atomTitles.length > 0 && input.atomTitles[0]?.trim()) {
    microSource = input.atomTitles[0].trim().slice(0, 140);
  } else if (topicTrim.length > 0) {
    microSource = topicTrim.slice(0, 140);
  }

  const patch: CategoryTaxonomyV1Patch = {
    domain,
    subdomain,
  };

  if (microSource.length > 0) {
    patch.microTopic = slugifySegment(microSource, MAX_MICRO);
  }

  if (curiosityTrim.length > 0) {
    patch.intentHint = curiosityTrim.replace(/\s+/g, " ").trim().slice(0, MAX_INTENT);
  }

  const diff = input.sessionDifficulty?.replace(/\s+/g, " ").trim().toLowerCase();
  if (diff && diff.length > 0 && diff.length <= 40) {
    patch.difficultySignal = diff;
  }

  if (input.atomTitles && input.atomTitles.length > 0) {
    patch.formatAffinity = "lesson_plus_atoms";
  } else {
    patch.formatAffinity = "lesson_session";
  }

  return patch;
}

/**
 * Applies taxonomy patch to an existing category row. Swallows errors (caller may log).
 */
export async function applyKnowledgeCategoryTaxonomyV1(input: {
  userId: string;
  categoryId: string;
  topic: string;
  curiosityPrompt: string;
  sessionDifficulty?: string | null | undefined;
  atomTitles?: readonly string[] | undefined;
}): Promise<void> {
  try {
    const patch = mapLessonSignalsToTaxonomyV1({
      topic: input.topic,
      curiosityPrompt: input.curiosityPrompt,
      sessionDifficulty: input.sessionDifficulty,
      atomTitles: input.atomTitles,
    });
    await knowledgeCategoryRepository.updateKnowledgeCategoryTaxonomyFields(
      input.userId,
      input.categoryId,
      patch,
    );
  } catch (error) {
    console.error("[knowledge_category_taxonomy_failed]", {
      userId: input.userId,
      categoryId: input.categoryId,
      error,
    });
  }
}

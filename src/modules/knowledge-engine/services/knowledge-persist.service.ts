import { KnowledgeNodeKind, KnowledgeSourceType } from "@prisma/client";
import { getEnv } from "../../../config/env";
import type { PersistGeneratedLessonKnowledgeInput } from "../knowledge-engine.types";
import { applyKnowledgeCategoryTaxonomyV1 } from "./category-taxonomy.service";
import { tryBridgeKnowledgeCategoryToGlobalConceptV1 } from "./global-wiki-bridge.service";
import { buildCategoryNormalizedKeyV1 } from "../knowledge-keys";
import * as knowledgeCategoryRepository from "../repositories/knowledge-category.repository";
import * as knowledgeNodeRepository from "../repositories/knowledge-node.repository";

/**
 * Slice A — Personal Brain persistence after a lesson is generated.
 *
 * Idempotency (database-enforced + deterministic keys):
 *
 * 1) KnowledgeCategory — at most one row per (userId, normalizedKey) via @@unique.
 *    - normalizedKey = `v1:tc:` + SHA-256( trim(topic) + "\\n" + trim(curiosityPrompt) ) (hex).
 *    - Same topic + same curiosity ⇒ same category for that user (sessions can converge).
 *    - Upsert updates refresh `label`, `sourceSessionId`, and timestamps for the latest touch.
 *
 * 2) KnowledgeNode — at most one row per (userId, sourceType, sourceId) via @@unique.
 *    - V1: sourceType = LEARNING_SESSION, sourceId = LearningSession.id.
 *    - Re-running generate for the same session updates title/summary/metadata/category link.
 *
 * No LLM calls here — only deterministic fields from the session + generated lesson payload.
 */
export async function persistGeneratedLessonKnowledge(
  input: PersistGeneratedLessonKnowledgeInput,
): Promise<void> {
  if (!getEnv().KNOWLEDGE_ENGINE_ENABLED) {
    console.info("[knowledge_engine_persist_skipped]", {
      sessionId: input.session.id,
      userId: input.userId,
      reason: "KNOWLEDGE_ENGINE_DISABLED",
    });
    return;
  }

  const topic = input.session.topic.trim();
  const curiosity = input.session.curiosityPrompt.trim();
  const label =
    topic.length > 0 ? input.session.topic.trim() : curiosity.slice(0, 200) || "Learning session";

  const normalizedKey = buildCategoryNormalizedKeyV1(topic, curiosity);

  const category = await knowledgeCategoryRepository.upsertKnowledgeCategory({
    userId: input.userId,
    normalizedKey,
    label,
    sourceSessionId: input.session.id,
  });

  await applyKnowledgeCategoryTaxonomyV1({
    userId: input.userId,
    categoryId: category.id,
    topic: input.session.topic,
    curiosityPrompt: input.session.curiosityPrompt,
    sessionDifficulty: input.session.difficulty,
    atomTitles: undefined,
  });

  await tryBridgeKnowledgeCategoryToGlobalConceptV1({
    userId: input.userId,
    categoryId: category.id,
    sessionId: input.session.id,
    stage: "persist_lesson",
  });

  const title =
    input.lesson.lessonTitle.trim().length > 0 ? input.lesson.lessonTitle.trim() : label;
  const summary =
    input.lesson.lessonSummary.trim().length > 0 ? input.lesson.lessonSummary.trim() : null;

  const metadataJson = {
    schemaVersion: 1,
    topic: input.session.topic,
    curiosityPrompt: input.session.curiosityPrompt,
    wowFactsCount: input.lesson.wowFacts.length,
    lessonBodyChars: input.lesson.lessonBody.length,
  };

  await knowledgeNodeRepository.upsertKnowledgeNode({
    userId: input.userId,
    sourceType: KnowledgeSourceType.LEARNING_SESSION,
    sourceId: input.session.id,
    title,
    summary,
    kind: KnowledgeNodeKind.SESSION_LESSON,
    categoryId: category.id,
    metadataJson,
  });

  console.info("[knowledge_engine_seed_persisted]", {
    sessionId: input.session.id,
    userId: input.userId,
    sourceType: "LEARNING_SESSION",
    kind: "SESSION_LESSON",
  });
}

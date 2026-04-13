import { createHash } from "node:crypto";
import { KnowledgeNodeKind, KnowledgeSourceType } from "@prisma/client";
import { runAiTask } from "../../ai/router/model-router.service";
import type { PlanTier } from "../../ai/providers/ai-provider.types";
import { getEnv } from "../../../config/env";
import {
  lessonKnowledgeExtractionResultSchema,
  type ExtractedLessonAtom,
} from "../knowledge-engine.schema";
import { applyKnowledgeCategoryTaxonomyV1 } from "./category-taxonomy.service";
import { tryBridgeKnowledgeCategoryToGlobalConceptV1 } from "./global-wiki-bridge.service";
import { buildCategoryNormalizedKeyV1 } from "../knowledge-keys";
import * as knowledgeCategoryRepository from "../repositories/knowledge-category.repository";
import * as knowledgeNodeRepository from "../repositories/knowledge-node.repository";
import {
  normalizeLessonExtractionPayload,
  summarizeExtractionPayloadForLog,
  unwrapExtractionContent,
} from "./knowledge-extraction-preprocess";

const MAX_LESSON_BODY_CHARS = 10_000;
const MAX_PERSISTED_CONCEPTS = 5;
const LOG_PREVIEW_MAX = 220;

function typeTag(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function boundedPreview(value: unknown, max = LOG_PREVIEW_MAX): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "string") {
    const t = value.replace(/\s+/g, " ").trim();
    return t.length <= max ? t : `${t.slice(0, max)}…`;
  }
  try {
    const s = JSON.stringify(value);
    return s.length <= max ? s : `${s.slice(0, max)}…`;
  } catch {
    return "[unpreviewable]";
  }
}

/**
 * Slice C — structured atomic concepts from lesson text (LLM + strict Zod).
 *
 * Idempotency for each persisted atom:
 * - sourceType = LESSON_ATOMIC
 * - sourceId = `${sessionId}:atom:v1:${sha256(normalizedTitle).slice(0,24)}`
 *   where normalizedTitle is lowercase collapsed whitespace of the concept title.
 * - @@unique([userId, sourceType, sourceId]) ⇒ upsert updates title/summary/metadata on re-run.
 *
 * Within a single extraction response, duplicates by normalized title are collapsed (first wins).
 *
 * Does not throw: logs and returns on AI/validation/persist issues so callers never break the lesson flow.
 */
export async function extractAndPersistLessonKnowledgeAtoms(input: {
  userId: string;
  planTier: PlanTier;
  session: {
    id: string;
    topic: string;
    curiosityPrompt: string;
    difficulty?: string | null;
  };
  lesson: { lessonTitle: string; lessonSummary: string; lessonBody: string };
}): Promise<void> {
  if (!getEnv().KNOWLEDGE_ENGINE_ENABLED) {
    console.info("[knowledge_engine_extraction_skipped]", {
      sessionId: input.session.id,
      userId: input.userId,
      reason: "KNOWLEDGE_ENGINE_DISABLED",
    });
    return;
  }

  console.info("[knowledge_extraction_active_v3]", {
    phase: "extractAndPersistLessonKnowledgeAtoms_entry",
    sessionId: input.session.id,
    userId: input.userId,
    planTier: input.planTier,
  });

  const topicTrim = input.session.topic.trim();
  const curiosityTrim = input.session.curiosityPrompt.trim();
  const label =
    topicTrim.length > 0 ? input.session.topic.trim() : curiosityTrim.slice(0, 200) || "Learning session";
  const normalizedKey = buildCategoryNormalizedKeyV1(topicTrim, curiosityTrim);

  let validated: ExtractedLessonAtom[];
  try {
    validated = await runLessonKnowledgeExtractionAi({
      userId: input.userId,
      planTier: input.planTier,
      sessionId: input.session.id,
      topic: input.session.topic,
      curiosityPrompt: input.session.curiosityPrompt,
      lessonTitle: input.lesson.lessonTitle,
      lessonSummary: input.lesson.lessonSummary,
      lessonBody: truncateBody(input.lesson.lessonBody),
    });
  } catch (error) {
    console.error("[knowledge_extraction_ai_failed]", {
      sessionId: input.session.id,
      userId: input.userId,
      stage: "runAiTask",
      error,
    });
    return;
  }

  if (validated.length === 0) {
    console.warn("[knowledge_extraction_no_atoms]", {
      sessionId: input.session.id,
      userId: input.userId,
      note: "Extraction produced zero atoms; check earlier knowledge_extraction_* logs for this request.",
    });
    return;
  }

  let categoryId: string;
  try {
    const category = await knowledgeCategoryRepository.upsertKnowledgeCategory({
      userId: input.userId,
      normalizedKey,
      label,
      sourceSessionId: input.session.id,
    });
    categoryId = category.id;
  } catch (error) {
    console.error("[knowledge_extraction_category_failed]", {
      sessionId: input.session.id,
      userId: input.userId,
      error,
    });
    return;
  }

  await applyKnowledgeCategoryTaxonomyV1({
    userId: input.userId,
    categoryId,
    topic: input.session.topic,
    curiosityPrompt: input.session.curiosityPrompt,
    sessionDifficulty: input.session.difficulty,
    atomTitles: validated.map((a) => a.title),
  });

  await tryBridgeKnowledgeCategoryToGlobalConceptV1({
    userId: input.userId,
    categoryId,
    sessionId: input.session.id,
    stage: "extract_atoms",
  });

  let persistedAtomCount = 0;
  for (const atom of validated) {
    const sourceId = buildLessonAtomicSourceId(input.session.id, atom.title);
    const metadataJson = {
      schemaVersion: 1,
      extraction: "lesson_atomic_v1",
      learningSessionId: input.session.id,
      topic: input.session.topic,
      modelKind: atom.kind,
      ...(atom.confidence !== undefined ? { confidence: atom.confidence } : {}),
    };

    try {
      await knowledgeNodeRepository.upsertKnowledgeNode({
        userId: input.userId,
        sourceType: KnowledgeSourceType.LESSON_ATOMIC,
        sourceId,
        title: atom.title.trim(),
        summary: atom.summary?.trim() ? atom.summary.trim() : null,
        kind: KnowledgeNodeKind.ATOMIC_CONCEPT,
        categoryId,
        metadataJson,
      });
      persistedAtomCount += 1;
    } catch (error) {
      console.error("[knowledge_extraction_node_upsert_failed]", {
        sessionId: input.session.id,
        userId: input.userId,
        sourceId,
        error,
      });
    }
  }

  console.info("[knowledge_extraction_persisted]", {
    sessionId: input.session.id,
    userId: input.userId,
    validatedConceptCount: validated.length,
    persistedAtomCount,
    smokeExpect:
      "persistedAtomCount should equal validatedConceptCount unless individual upserts failed (see knowledge_extraction_node_upsert_failed).",
  });
}

/**
 * Runs the LLM once, parses JSON, validates with Zod. Returns [] on any malformed output.
 */
async function runLessonKnowledgeExtractionAi(input: {
  userId: string;
  planTier: PlanTier;
  sessionId: string;
  topic: string;
  curiosityPrompt: string;
  lessonTitle: string;
  lessonSummary: string;
  lessonBody: string;
}): Promise<ExtractedLessonAtom[]> {
  const output = await runAiTask({
    taskType: "knowledge_extraction",
    planTier: input.planTier,
    responseFormat: "json",
    messages: [
      { role: "system", content: buildExtractionSystemPrompt() },
      {
        role: "user",
        content: buildExtractionUserPrompt({
          topic: input.topic,
          curiosityPrompt: input.curiosityPrompt,
          lessonTitle: input.lessonTitle,
          lessonSummary: input.lessonSummary,
          lessonBody: input.lessonBody,
        }),
      },
    ],
    metadata: {
      userId: input.userId,
      sessionId: input.sessionId,
      stage: "knowledge_extraction",
    },
  });

  const meta = {
    sessionId: input.sessionId,
    userId: input.userId,
    provider: output.provider,
    model: output.model,
  };

  console.info("[knowledge_extraction_active_v3]", {
    phase: "post_ai_pre_unwrap",
    ...meta,
    rawContentType: typeof output.content,
    rawIsArray: Array.isArray(output.content),
    rawIsNull: output.content === null,
    rawTypeTag: typeTag(output.content),
  });

  const unwrapped = unwrapExtractionContent(output.content);
  if (!unwrapped.ok) {
    console.error("[knowledge_extraction_parse_failed_v2]", {
      ...meta,
      stage: "unwrap_content",
      parseCode: unwrapped.code,
      rawContentType: typeof output.content,
      unwrappedType: "n/a",
      isArray: Array.isArray(output.content),
      safePreview: boundedPreview(output.content),
      contentShape: summarizeExtractionPayloadForLog(output.content, 320),
      ...(unwrapped.preview ? { unwrapPreview: unwrapped.preview } : {}),
      ...(unwrapped.detail ? { unwrapDetail: unwrapped.detail } : {}),
    });
    return [];
  }

  if (unwrapped.value === null || typeof unwrapped.value !== "object") {
    console.error("[knowledge_extraction_parse_failed_v2]", {
      ...meta,
      stage: "post_unwrap_type",
      parseCode: "non_object_json",
      rawContentType: typeof output.content,
      unwrappedType: typeof unwrapped.value,
      isArray: Array.isArray(unwrapped.value),
      safePreview: boundedPreview(unwrapped.value),
      contentShape: summarizeExtractionPayloadForLog(output.content, 320),
    });
    return [];
  }

  console.info("[knowledge_extraction_active_v3]", {
    phase: "post_unwrap_ok",
    ...meta,
    unwrappedType: typeof unwrapped.value,
    unwrappedIsArray: Array.isArray(unwrapped.value),
    unwrappedTypeTag: typeTag(unwrapped.value),
  });

  const normalized = normalizeLessonExtractionPayload(unwrapped.value);
  if (!normalized) {
    console.error("[knowledge_extraction_normalize_failed]", {
      ...meta,
      stage: "normalize_payload",
      payloadSummary: summarizeExtractionPayloadForLog(unwrapped.value),
    });
    return [];
  }

  const safe = lessonKnowledgeExtractionResultSchema.safeParse(normalized);
  if (!safe.success) {
    console.error("[knowledge_extraction_validation_failed]", {
      ...meta,
      stage: "zod_strict",
      issues: safe.error.flatten(),
      normalizedSummary: summarizeExtractionPayloadForLog(normalized),
    });
    return [];
  }

  return dedupeAtomsByNormalizedTitle(safe.data.concepts).slice(0, MAX_PERSISTED_CONCEPTS);
}

function dedupeAtomsByNormalizedTitle(atoms: ExtractedLessonAtom[]): ExtractedLessonAtom[] {
  const seen = new Set<string>();
  const out: ExtractedLessonAtom[] = [];
  for (const atom of atoms) {
    const key = normalizeTitleKey(atom.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(atom);
  }
  return out;
}

function normalizeTitleKey(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Stable sourceId for LESSON_ATOMIC rows: same user + session + normalized title ⇒ one row.
 */
function buildLessonAtomicSourceId(sessionId: string, title: string): string {
  const key = normalizeTitleKey(title);
  const hash = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 24);
  return `${sessionId}:atom:v1:${hash}`;
}

function truncateBody(body: string): string {
  const t = body.trim();
  if (t.length <= MAX_LESSON_BODY_CHARS) return t;
  return `${t.slice(0, MAX_LESSON_BODY_CHARS)}\n\n[truncated]`;
}

function buildExtractionSystemPrompt(): string {
  return `
You extract a SMALL set of atomic, reusable knowledge units from an educational lesson.

Rules:
- Return ONLY valid JSON matching the exact shape below. No markdown fences.
- 3 to 6 concepts preferred; each must be distinct and non-overlapping.
- Titles: short noun phrases (max ~12 words). Summaries: one or two crisp sentences, no lesson copy-paste.
- Each concept should stand alone for future recall (definition, relationship, pitfall, technique, etc.).
- kind: optional short tag like "definition", "mechanism", "pitfall", "example_pattern".
- confidence: optional number 0–1 for how central the concept is to the lesson.

JSON shape:
{
  "concepts": [
    { "title": "string", "summary": "string (optional)", "kind": "string (optional)", "confidence": 0.0 }
  ]
}
`.trim();
}

function buildExtractionUserPrompt(input: {
  topic: string;
  curiosityPrompt: string;
  lessonTitle: string;
  lessonSummary: string;
  lessonBody: string;
}): string {
  return `
Session topic: ${input.topic}
Curiosity: ${input.curiosityPrompt}

Lesson title: ${input.lessonTitle}
Lesson summary: ${input.lessonSummary}

Lesson body:
${input.lessonBody}

Extract concepts JSON only.
`.trim();
}

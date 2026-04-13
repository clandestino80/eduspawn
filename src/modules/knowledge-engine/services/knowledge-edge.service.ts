import { KnowledgeRelationType } from "@prisma/client";
import { getEnv } from "../../../config/env";
import * as knowledgeEdgeRepository from "../repositories/knowledge-edge.repository";

/** V1 provenance: all deterministic lesson-graph edges share this type + session id as sourceId. */
export const LESSON_GRAPH_EDGE_SOURCE_TYPE = "LESSON_SESSION_GRAPH" as const;

/**
 * Slice D — deterministic edges for one learning session’s knowledge subgraph.
 *
 * Rules (V1, no LLM):
 * 1) REINFORCES: seed `SESSION_LESSON` node → each `ATOMIC_CONCEPT` from this session (lesson reinforces concepts).
 * 2) RELATED_TO: hub among atoms — pick lexicographically smallest node id as hub; hub → every other atom
 *    (same-session cohesion without O(n²) cliques).
 *
 * Idempotency (DB + provenance):
 * - @@unique([userId, fromNodeId, toNodeId, relationType, sourceType, sourceId])
 * - sourceType = LESSON_SESSION_GRAPH, sourceId = learningSessionId
 *   ⇒ re-running sync upserts the same edges without duplicates.
 *
 * Never throws; per-edge failures are logged and skipped.
 */
export async function syncLessonKnowledgeEdges(input: {
  userId: string;
  sessionId: string;
}): Promise<void> {
  if (!getEnv().KNOWLEDGE_ENGINE_ENABLED) {
    console.info("[knowledge_engine_edge_sync_skipped]", {
      sessionId: input.sessionId,
      userId: input.userId,
      reason: "KNOWLEDGE_ENGINE_DISABLED",
    });
    return;
  }

  const { userId, sessionId } = input;
  const sourceType = LESSON_GRAPH_EDGE_SOURCE_TYPE;
  const sourceId = sessionId;

  let seed: { id: string } | null;
  let atoms: { id: string }[];
  try {
    seed = await knowledgeEdgeRepository.findSeedLessonNodeId(userId, sessionId);
    atoms = await knowledgeEdgeRepository.findAtomicNodeIdsForSession(userId, sessionId);
  } catch (error) {
    console.error("[knowledge_edge_query_failed]", { sessionId, userId, error });
    return;
  }

  const atomIds = atoms.map((a) => a.id).filter(Boolean);
  if (atomIds.length === 0) {
    console.info("[knowledge_engine_edge_sync_no_atoms]", {
      sessionId,
      userId,
      seedLessonNodeFound: Boolean(seed),
      atomCount: 0,
      smokeExpect:
        "No LESSON_ATOMIC nodes for this session yet (extraction empty or failed, or engine off earlier). Edge count stays 0.",
    });
    return;
  }

  if (seed) {
    for (const atomId of atomIds) {
      if (atomId === seed.id) continue;
      await safeUpsertEdge({
        userId,
        fromNodeId: seed.id,
        toNodeId: atomId,
        relationType: KnowledgeRelationType.REINFORCES,
        sourceType,
        sourceId,
        sessionId,
      });
    }
  }

  if (atomIds.length < 2) {
    return;
  }

  const hubId = atomIds.reduce((a, b) => (a < b ? a : b));
  for (const atomId of atomIds) {
    if (atomId === hubId) continue;
    await safeUpsertEdge({
      userId,
      fromNodeId: hubId,
      toNodeId: atomId,
      relationType: KnowledgeRelationType.RELATED_TO,
      sourceType,
      sourceId,
      sessionId,
    });
  }

  const reinforcesPlanned =
    seed !== null ? atomIds.filter((id) => id !== seed.id).length : 0;
  const relatedPlanned = atomIds.length >= 2 ? Math.max(0, atomIds.length - 1) : 0;
  console.info("[knowledge_engine_edge_sync_completed]", {
    sessionId,
    userId,
    seedLessonNodeFound: Boolean(seed),
    atomCount: atomIds.length,
    reinforcesEdgesPlanned: reinforcesPlanned,
    relatedToEdgesPlanned: relatedPlanned,
    smokeExpect:
      "Upserts are idempotent; planned counts reflect graph shape. Check DB or generate_digest for final edge totals.",
  });
}

async function safeUpsertEdge(input: {
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: KnowledgeRelationType;
  sourceType: string;
  sourceId: string;
  sessionId: string;
}): Promise<void> {
  if (input.fromNodeId === input.toNodeId) {
    return;
  }

  try {
    await knowledgeEdgeRepository.upsertKnowledgeEdge({
      userId: input.userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      relationType: input.relationType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
  } catch (error) {
    console.error("[knowledge_edge_upsert_failed]", {
      sessionId: input.sessionId,
      userId: input.userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      relationType: input.relationType,
      error,
    });
  }
}

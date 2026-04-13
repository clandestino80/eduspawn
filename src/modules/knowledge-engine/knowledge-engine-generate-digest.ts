import { KnowledgeNodeKind, KnowledgeSourceType } from "@prisma/client";
import { getEnv } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { LESSON_GRAPH_EDGE_SOURCE_TYPE } from "./services/knowledge-edge.service";

/**
 * Post-generate read-only counts for smoke tests and ops (one `console.info` line per call).
 * Does not throw; logs `[knowledge_engine_generate_digest_failed]` on query errors.
 */
export async function logKnowledgeEnginePostGenerateDigest(input: {
  userId: string;
  sessionId: string;
}): Promise<void> {
  const env = getEnv();
  const base = {
    sessionId: input.sessionId,
    userId: input.userId,
    KNOWLEDGE_ENGINE_ENABLED: env.KNOWLEDGE_ENGINE_ENABLED,
    KNOWLEDGE_CONTEXT_INJECTION_ENABLED: env.KNOWLEDGE_CONTEXT_INJECTION_ENABLED,
  };

  if (!env.KNOWLEDGE_ENGINE_ENABLED) {
    console.info("[knowledge_engine_generate_digest]", {
      ...base,
      seedSessionLessonNodeCount: 0,
      atomicConceptNodeCount: 0,
      lessonGraphEdgeCount: 0,
      smokeExpect:
        "With KNOWLEDGE_ENGINE_ENABLED=false, seed/atoms/edges are not written; enable flag to expect seed=1 after successful persist.",
    });
    return;
  }

  try {
    const [seedSessionLessonNodeCount, atomicConceptNodeCount, lessonGraphEdgeCount] =
      await Promise.all([
        prisma.knowledgeNode.count({
          where: {
            userId: input.userId,
            kind: KnowledgeNodeKind.SESSION_LESSON,
            sourceType: KnowledgeSourceType.LEARNING_SESSION,
            sourceId: input.sessionId,
          },
        }),
        prisma.knowledgeNode.count({
          where: {
            userId: input.userId,
            kind: KnowledgeNodeKind.ATOMIC_CONCEPT,
            sourceType: KnowledgeSourceType.LESSON_ATOMIC,
            metadataJson: {
              path: ["learningSessionId"],
              equals: input.sessionId,
            },
          },
        }),
        prisma.knowledgeEdge.count({
          where: {
            userId: input.userId,
            sourceType: LESSON_GRAPH_EDGE_SOURCE_TYPE,
            sourceId: input.sessionId,
          },
        }),
      ]);

    console.info("[knowledge_engine_generate_digest]", {
      ...base,
      seedSessionLessonNodeCount,
      atomicConceptNodeCount,
      lessonGraphEdgeCount,
      smokeExpect:
        "Healthy generate (engine on): seedSessionLessonNodeCount=1; atomicConceptNodeCount>=1 when extraction succeeded; lessonGraphEdgeCount>=1 when atoms>=1 and edge sync ran.",
    });
  } catch (error) {
    console.warn("[knowledge_engine_generate_digest_failed]", {
      sessionId: input.sessionId,
      userId: input.userId,
      error,
    });
  }
}

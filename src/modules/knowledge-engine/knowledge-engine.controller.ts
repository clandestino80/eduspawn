import type { Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../lib/errors";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import {
  globalConceptEnrichOpsQuerySchema,
  globalConceptListQuerySchema,
  globalConceptRecommendedQuerySchema,
  knowledgeEngineListQuerySchema,
  knowledgeEngineMemoryPreviewQuerySchema,
  topicFeedQuerySchema,
  topicInventoryIdParamsSchema,
  topicSavedListQuerySchema,
} from "./knowledge-engine.schema";
import {
  getGlobalConceptBySlugForReadApi,
  listGlobalConceptsForReadApi,
} from "./services/global-concept-read.service";
import { runSingleConceptArticleEnrichmentBySlugForOpsV1 } from "./services/global-concept-article-enrich-ops.service";
import { listRecommendedGlobalConceptsForReadApi } from "./services/global-concept-recommendation.service";
import { listTopicFeedForUserWithCache } from "./services/topic-feed-cache.service";
import { listSavedTopicsForUserApi, listTopicFeedForUserApi } from "./services/topic-feed.service";
import {
  getLearningDnaReadSnapshot,
  getMemoryPreviewForReadApi,
  listKnowledgeEdgesForReadApi,
  listKnowledgeNodesForReadApi,
} from "./services/knowledge-engine-read.service";
import {
  markTopicDismissed,
  markTopicOpened,
  markTopicSaved,
  markTopicSeen,
  markTopicUnsaved,
} from "./services/user-topic-state.service";

function mapValidationError(error: ZodError): AppError {
  return new AppError(400, "Request validation failed", {
    code: "VALIDATION_ERROR",
    details: error.flatten().fieldErrors,
  });
}

function parseOrThrow<T>(parseFn: () => T): T {
  try {
    return parseFn();
  } catch (error) {
    if (error instanceof ZodError) {
      throw mapValidationError(error);
    }
    throw error;
  }
}

function getUserId(req: Request): string {
  const authReq = req as AuthenticatedRequest & {
    user?: { sub?: string; userId?: string; id?: string };
  };
  const userId = authReq.user?.userId ?? authReq.user?.sub ?? authReq.user?.id;
  if (!userId) {
    throw new AppError(401, "Unauthorized", { code: "AUTH_UNAUTHORIZED" });
  }
  return userId;
}

export async function listKnowledgeNodesController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const query = parseOrThrow(() =>
    knowledgeEngineListQuerySchema.parse(req.query),
  );
  const nodes = await listKnowledgeNodesForReadApi(userId, query.limit);
  res.status(200).json({ success: true, data: { nodes } });
}

export async function listKnowledgeEdgesController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const query = parseOrThrow(() =>
    knowledgeEngineListQuerySchema.parse(req.query),
  );
  const edges = await listKnowledgeEdgesForReadApi(userId, query.limit);
  res.status(200).json({ success: true, data: { edges } });
}

export async function getKnowledgeDnaSnapshotController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const snapshot = await getLearningDnaReadSnapshot(userId);
  res.status(200).json({
    success: true,
    data: {
      dna: snapshot,
    },
  });
}

export async function getMemoryPreviewController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const query = parseOrThrow(() =>
    knowledgeEngineMemoryPreviewQuerySchema.parse({
      topic: req.query.topic,
      curiosityPrompt: req.query.curiosityPrompt,
    }),
  );
  const preview = await getMemoryPreviewForReadApi({
    userId,
    topic: query.topic,
    curiosityPrompt: query.curiosityPrompt ?? "",
  });
  res.status(200).json({ success: true, data: preview });
}

export async function listGlobalConceptsController(req: Request, res: Response): Promise<void> {
  getUserId(req);
  const query = parseOrThrow(() => globalConceptListQuerySchema.parse(req.query));
  const concepts = await listGlobalConceptsForReadApi({
    limit: query.limit,
    domain: query.domain,
    subdomain: query.subdomain,
  });
  res.status(200).json({ success: true, data: { concepts } });
}

export async function getRecommendedGlobalConceptsController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const query = parseOrThrow(() => globalConceptRecommendedQuerySchema.parse(req.query));
  const recommendations = await listRecommendedGlobalConceptsForReadApi({
    userId,
    limit: query.limit,
    domain: query.domain,
    subdomain: query.subdomain,
    mode: query.mode,
  });
  res.status(200).json({
    success: true,
    data: {
      mode: query.mode,
      recommendations,
    },
  });
}

/** Slice B/E — read-only global topic feed (optional in-process cache; inventory + user state; no LLM, no metering). */
export async function getTopicFeedController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const query = parseOrThrow(() => topicFeedQuerySchema.parse(req.query));
  const data = await listTopicFeedForUserWithCache(
    {
      userId,
      limit: query.limit,
      domain: query.domain,
      subdomain: query.subdomain,
    },
    () =>
      listTopicFeedForUserApi({
        userId,
        limit: query.limit,
        domain: query.domain,
        subdomain: query.subdomain,
      }),
  );
  res.status(200).json({ success: true, data });
}

/** Read-only saved topics (inventory + `UserTopicState.savedAt`). */
export async function getSavedTopicsController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const query = parseOrThrow(() => topicSavedListQuerySchema.parse(req.query));
  const data = await listSavedTopicsForUserApi({ userId, limit: query.limit });
  res.status(200).json({ success: true, data });
}

/** Slice F — explicit topic interactions (no metering; invalidates per-user feed cache where applicable). */
export async function postTopicOpenController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const { id } = parseOrThrow(() => topicInventoryIdParamsSchema.parse(req.params));
  const data = await markTopicOpened({ userId, globalTopicId: id });
  res.status(200).json({ success: true, data });
}

export async function postTopicDismissController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const { id } = parseOrThrow(() => topicInventoryIdParamsSchema.parse(req.params));
  const data = await markTopicDismissed({ userId, globalTopicId: id });
  res.status(200).json({ success: true, data });
}

export async function postTopicSaveController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const { id } = parseOrThrow(() => topicInventoryIdParamsSchema.parse(req.params));
  const data = await markTopicSaved({ userId, globalTopicId: id });
  res.status(200).json({ success: true, data });
}

export async function postTopicUnsaveController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const { id } = parseOrThrow(() => topicInventoryIdParamsSchema.parse(req.params));
  const data = await markTopicUnsaved({ userId, globalTopicId: id });
  res.status(200).json({ success: true, data });
}

export async function postTopicSeenController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const { id } = parseOrThrow(() => topicInventoryIdParamsSchema.parse(req.params));
  const data = await markTopicSeen({ userId, globalTopicId: id });
  res.status(200).json({ success: true, data });
}

export async function getGlobalConceptBySlugController(req: Request, res: Response): Promise<void> {
  getUserId(req);
  const raw = String(req.params.slug ?? "").trim();
  const slug = decodeURIComponent(raw);
  if (!slug) {
    throw new AppError(400, "Missing concept slug", { code: "VALIDATION_ERROR" });
  }
  if (slug.length > 240) {
    throw new AppError(400, "Slug too long", { code: "VALIDATION_ERROR" });
  }
  const concept = await getGlobalConceptBySlugForReadApi(slug);
  if (!concept) {
    throw new AppError(404, "Concept not found", { code: "NOT_FOUND" });
  }
  res.status(200).json({ success: true, data: { concept } });
}

/**
 * Ops: run deterministic seed (if missing) + bounded AI enrichment for one concept. Authenticated; not a public wiki write API.
 */
export async function enrichGlobalConceptArticleBySlugController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const raw = String(req.params.slug ?? "").trim();
  const slug = decodeURIComponent(raw);
  if (!slug) {
    throw new AppError(400, "Missing concept slug", { code: "VALIDATION_ERROR" });
  }
  if (slug.length > 240) {
    throw new AppError(400, "Slug too long", { code: "VALIDATION_ERROR" });
  }

  const query = parseOrThrow(() => globalConceptEnrichOpsQuerySchema.parse(req.query));

  const result = await runSingleConceptArticleEnrichmentBySlugForOpsV1({
    slug,
    dryRun: query.dryRun,
    logContext: { userId },
  });

  if (result.outcome === "not_found") {
    throw new AppError(404, result.message, { code: "NOT_FOUND" });
  }

  res.status(200).json({ success: result.success, data: result });
}

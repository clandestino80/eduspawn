import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireKnowledgeOps } from "../../middleware/knowledge-ops.middleware";
import {
  enrichGlobalConceptArticleBySlugController,
  getGlobalConceptBySlugController,
  getKnowledgeDnaSnapshotController,
  getMemoryPreviewController,
  getRecommendedGlobalConceptsController,
  getTopicFeedController,
  getSavedTopicsController,
  postTopicDismissController,
  postTopicOpenController,
  postTopicSaveController,
  postTopicSeenController,
  postTopicUnsaveController,
  listGlobalConceptsController,
  listKnowledgeEdgesController,
  listKnowledgeNodesController,
} from "./knowledge-engine.controller";

/**
 * Slice F — authenticated read/debug surface for the Personal Brain (writes limited to explicit ops paths).
 * Global concept catalog reads (cross-user anchors + article seeds) live here too.
 */
export const knowledgeEngineRouter = Router();

knowledgeEngineRouter.use(requireAuth);

knowledgeEngineRouter.get("/nodes", asyncHandler(listKnowledgeNodesController));
knowledgeEngineRouter.get("/edges", asyncHandler(listKnowledgeEdgesController));
knowledgeEngineRouter.get("/dna", asyncHandler(getKnowledgeDnaSnapshotController));
knowledgeEngineRouter.get("/memory-preview", asyncHandler(getMemoryPreviewController));
/** Slice B — static path before `/topics/:id/...` routes. */
knowledgeEngineRouter.get("/topics/feed", asyncHandler(getTopicFeedController));
knowledgeEngineRouter.get("/topics/saved", asyncHandler(getSavedTopicsController));
/** Slice F — explicit topic state writes (must stay after `/topics/feed`). */
knowledgeEngineRouter.post("/topics/:id/open", asyncHandler(postTopicOpenController));
knowledgeEngineRouter.post("/topics/:id/dismiss", asyncHandler(postTopicDismissController));
knowledgeEngineRouter.post("/topics/:id/save", asyncHandler(postTopicSaveController));
knowledgeEngineRouter.post("/topics/:id/unsave", asyncHandler(postTopicUnsaveController));
knowledgeEngineRouter.post("/topics/:id/seen", asyncHandler(postTopicSeenController));
knowledgeEngineRouter.get("/concepts", asyncHandler(listGlobalConceptsController));
knowledgeEngineRouter.get("/concepts/recommended", asyncHandler(getRecommendedGlobalConceptsController));
/** Ops-only writes: keep `requireKnowledgeOps` on any future POST/PATCH/DELETE under this router unless explicitly public. */
knowledgeEngineRouter.post(
  "/concepts/:slug/enrich",
  requireKnowledgeOps,
  asyncHandler(enrichGlobalConceptArticleBySlugController),
);
knowledgeEngineRouter.get("/concepts/:slug", asyncHandler(getGlobalConceptBySlugController));

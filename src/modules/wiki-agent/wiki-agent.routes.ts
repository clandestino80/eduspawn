import { Router } from "express";

/**
 * Future: wiki RAG, retrieval, agent orchestration.
 */
export const wikiAgentRouter = Router();

wikiAgentRouter.get("/status", (_req, res) => {
  res.status(200).json({
    success: true,
    data: { module: "wiki-agent", state: "scaffolded" },
  });
});

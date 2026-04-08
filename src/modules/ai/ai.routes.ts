import { Router } from "express";

/**
 * Future: LLM proxy, streaming, tool calls. Keep API keys only in env / secrets manager.
 */
export const aiRouter = Router();

aiRouter.get("/status", (_req, res) => {
  res.status(200).json({
    success: true,
    data: { module: "ai", state: "scaffolded" },
  });
});

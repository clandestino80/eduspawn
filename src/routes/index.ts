import type { Express } from "express";
import { Router } from "express";
import { analyticsRouter } from "../modules/analytics/analytics.routes";
import { aiRouter } from "../modules/ai/ai.routes";
import { authRouter } from "../modules/auth/auth.routes";
import { healthRouter } from "../modules/health/health.routes";
import { wikiAgentRouter } from "../modules/wiki-agent/wiki-agent.routes";

const v1 = Router();

v1.use("/health", healthRouter);
v1.use("/auth", authRouter);
v1.use("/ai", aiRouter);
v1.use("/analytics", analyticsRouter);
v1.use("/wiki-agent", wikiAgentRouter);

export function registerRoutes(app: Express): void {
  app.use("/health", healthRouter);
  app.use("/api/v1", v1);
}

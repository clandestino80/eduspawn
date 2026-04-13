import type { Express } from "express";
import { Router } from "express";
import { analyticsRouter } from "../modules/analytics/analytics.routes";
import { aiRouter } from "../modules/ai/ai.routes";
import { authRouter } from "../modules/auth/auth.route";
import { coreRouter } from "../modules/core/core.route";
import { healthRouter } from "../modules/health/health.routes";
import { wikiAgentRouter } from "../modules/wiki-agent/wiki-agent.routes";
import { knowledgeEngineRouter } from "../modules/knowledge-engine/knowledge-engine.routes";
import { billingCheckoutRouter } from "../modules/entitlements/billing-checkout.routes";
import { billingOpsRouter } from "../modules/entitlements/billing-ops.routes";
import { creatorRouter } from "../modules/creator/creator.routes";
import { renderRouter } from "../modules/render/render.routes";

const v1 = Router();

v1.use("/health", healthRouter);
v1.use("/auth", authRouter);
v1.use("/core", coreRouter);
v1.use("/ai", aiRouter);
v1.use("/analytics", analyticsRouter);
v1.use("/wiki-agent", wikiAgentRouter);
v1.use("/knowledge-engine", knowledgeEngineRouter);
v1.use("/ops/billing", billingOpsRouter);
v1.use("/billing", billingCheckoutRouter);
v1.use("/creator", creatorRouter);
v1.use("/render", renderRouter);

export function registerRoutes(app: Express): void {
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/api/v1", v1);
}

import { Router } from "express";

/**
 * Future: event ingestion, metrics export, dashboards.
 */
export const analyticsRouter = Router();

analyticsRouter.get("/status", (_req, res) => {
  res.status(200).json({
    success: true,
    data: { module: "analytics", state: "scaffolded" },
  });
});

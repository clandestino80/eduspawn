import { Router } from "express";
import { getEnv } from "../../config/env";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { rateLimitPerAuthenticatedUser, rateLimitPerIp } from "../../middleware/rate-limit.middleware";
import {
  getRenderJobController,
  handleProviderWebhook,
  listRenderJobsController,
  postRefreshRenderJobController,
  postRenderJobController,
} from "./render.controller";

export const renderRouter = Router();

const renderProviderWebhookIpLimit = rateLimitPerIp("render_provider_webhook", () => ({
  windowMs: getEnv().RATE_LIMIT_RENDER_WEBHOOK_IP_WINDOW_MS,
  max: getEnv().RATE_LIMIT_RENDER_WEBHOOK_IP_MAX,
}));

/** Provider completion (no JWT; protected by shared webhook secret). */
renderRouter.post("/webhooks/provider", renderProviderWebhookIpLimit, asyncHandler(handleProviderWebhook));

const renderJobCreateRateLimit = rateLimitPerAuthenticatedUser("render_job_create", () => ({
  windowMs: getEnv().RATE_LIMIT_RENDER_JOB_WINDOW_MS,
  max: getEnv().RATE_LIMIT_RENDER_JOB_MAX,
}));

const renderJobRefreshRateLimit = rateLimitPerAuthenticatedUser("render_job_refresh", () => ({
  windowMs: getEnv().RATE_LIMIT_RENDER_REFRESH_WINDOW_MS,
  max: getEnv().RATE_LIMIT_RENDER_REFRESH_MAX,
}));

const authed = Router();
authed.use(requireAuth);
authed.post("/jobs", renderJobCreateRateLimit, asyncHandler(postRenderJobController));
authed.get("/jobs", asyncHandler(listRenderJobsController));
authed.get("/jobs/:jobId", asyncHandler(getRenderJobController));
authed.post("/jobs/:jobId/refresh", renderJobRefreshRateLimit, asyncHandler(postRefreshRenderJobController));

renderRouter.use(authed);

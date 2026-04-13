import { Router } from "express";
import { getEnv } from "../../config/env";
import { requireAuth } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/asyncHandler";
import { rateLimitPerAuthenticatedUser } from "../../middleware/rate-limit.middleware";
import {
  generateCreatorController,
  getCreatorCapacityController,
  patchCreatorPackController,
} from "./creator.controller";

export const creatorRouter = Router();

creatorRouter.use(requireAuth);

const creatorGenerateRateLimit = rateLimitPerAuthenticatedUser("creator_generate", () => ({
  windowMs: getEnv().RATE_LIMIT_CREATOR_GENERATE_WINDOW_MS,
  max: getEnv().RATE_LIMIT_CREATOR_GENERATE_MAX,
}));

creatorRouter.get("/capacity", asyncHandler(getCreatorCapacityController));
creatorRouter.post("/generate", creatorGenerateRateLimit, asyncHandler(generateCreatorController));
creatorRouter.patch("/packs/:packId", asyncHandler(patchCreatorPackController));

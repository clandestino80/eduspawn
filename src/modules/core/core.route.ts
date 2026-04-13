import { Router } from "express";
import { getEnv } from "../../config/env";
import { requireAuth } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/asyncHandler";
import { rateLimitPerAuthenticatedUser } from "../../middleware/rate-limit.middleware";
import {
  createContentOutputController,
  createLongformOutputController,
  createQuizAttemptController,
  createSessionController,
  generateSessionLessonController,
  getDnaController,
  getLongformOutputController,
  getSessionOutputsController,
  getSessionController,
  listSessionsController,
  recordContentShareController,
  upsertDnaController,
} from "./core.controller";

const coreRouter = Router();

/**
 * All core engine routes are protected.
 * EduSpawn flow:
 * 1) Save / fetch Learning DNA
 * 2) Create learning session
 * 3) Generate lesson from curiosity prompt
 * 4) Submit quiz attempt
 * 5) Generate short-form content outputs
 * 6) Create / fetch long-form academic video script
 * 7) Track shares for generated content
 */
coreRouter.use(requireAuth);

/**
 * Learning DNA
 */
coreRouter.get("/dna", asyncHandler(getDnaController));
coreRouter.post("/dna", asyncHandler(upsertDnaController));

/**
 * Learning sessions (list route must be registered before `/sessions/:id`).
 */
coreRouter.get("/sessions", asyncHandler(listSessionsController));
coreRouter.post("/sessions", asyncHandler(createSessionController));
coreRouter.get("/sessions/:id", asyncHandler(getSessionController));

/**
 * Lesson generation
 */
coreRouter.post(
  "/sessions/:id/generate",
  asyncHandler(generateSessionLessonController),
);

/**
 * Quiz attempts
 */
coreRouter.post(
  "/sessions/:id/quiz",
  asyncHandler(createQuizAttemptController),
);

/**
 * Short-form / standard content outputs
 */
coreRouter.post(
  "/sessions/:id/output",
  asyncHandler(createContentOutputController),
);
coreRouter.get(
  "/sessions/:id/outputs",
  asyncHandler(getSessionOutputsController),
);

/**
 * Long-form academic video output
 */
coreRouter.post(
  "/sessions/:id/longform",
  longformGenerateRateLimit,
  asyncHandler(createLongformOutputController),
);
coreRouter.get(
  "/sessions/:id/longform",
  asyncHandler(getLongformOutputController),
);

/**
 * Share tracking for generated content outputs
 * :id = ContentOutput id
 */
coreRouter.post(
  "/content/:id/share",
  asyncHandler(recordContentShareController),
);

export { coreRouter };
export default coreRouter;
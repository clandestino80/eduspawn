import type { Request, Response } from "express";
import { ZodError, z } from "zod";
import { AppError } from "../../lib/errors";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import {
  createRenderJobBodySchema,
  listRenderJobsQuerySchema,
  renderJobIdParamsSchema,
} from "./schemas/render-request.schema";
import type { WebhookHeaderBag } from "./render-provider.types";
import {
  getRenderJobForUser,
  listRenderJobsForUserPublic,
  processRenderProviderWebhook,
  refreshRenderJobStatusForUser,
  startRenderJobForUser,
} from "./services/render-orchestration.service";

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
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.sub;
  if (!userId) {
    throw new AppError(401, "Unauthorized", { code: "AUTH_UNAUTHORIZED" });
  }
  return userId;
}

export async function postRenderJobController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const body = parseOrThrow(() => createRenderJobBodySchema.parse(req.body));
  const data = await startRenderJobForUser(userId, body);
  res.status(201).json({ success: true, data });
}

export async function listRenderJobsController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const q = parseOrThrow(() => listRenderJobsQuerySchema.parse(req.query));
  const data = await listRenderJobsForUserPublic(userId, q.limit);
  res.status(200).json({ success: true, data });
}

export async function getRenderJobController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const { jobId } = parseOrThrow(() => renderJobIdParamsSchema.parse(req.params));
  const data = await getRenderJobForUser(userId, jobId);
  res.status(200).json({ success: true, data });
}

export async function postRefreshRenderJobController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const { jobId } = parseOrThrow(() => renderJobIdParamsSchema.parse(req.params));
  const data = await refreshRenderJobStatusForUser(userId, jobId);
  res.status(200).json({ success: true, data });
}

export async function handleProviderWebhook(req: Request, res: Response): Promise<void> {
  const secret = req.header("x-eduspawn-render-webhook-secret");
  const headerBag: WebhookHeaderBag = {
    get: (name: string) => req.get(name) ?? undefined,
  };
  const data = await processRenderProviderWebhook(secret, req.body, headerBag);
  res.status(200).json({ success: true, data });
}

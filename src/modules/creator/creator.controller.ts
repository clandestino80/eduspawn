import type { Request, Response } from "express";
import { ZodError, z } from "zod";
import { AppError } from "../../lib/errors";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import {
  creatorGenerationRequestSchema,
  patchUserCreatorPackBodySchema,
} from "./schemas/creator-request.schema";
import { getCreatorCapacitySummary } from "./services/creator-capacity.service";
import {
  generateCreatorPackOrchestrated,
  saveUserEditedCreatorPack,
} from "./services/creator-orchestration.service";

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

const packIdParamsSchema = z.object({ packId: z.string().cuid() });

export async function getCreatorCapacityController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const data = await getCreatorCapacitySummary(userId);
  res.status(200).json({ success: true, data });
}

export async function generateCreatorController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const body = parseOrThrow(() => creatorGenerationRequestSchema.parse(req.body));
  const data = await generateCreatorPackOrchestrated(userId, body);
  res.status(200).json({ success: true, data });
}

export async function patchCreatorPackController(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const { packId } = parseOrThrow(() => packIdParamsSchema.parse(req.params));
  const parsed = parseOrThrow(() => patchUserCreatorPackBodySchema.parse(req.body));
  const data = await saveUserEditedCreatorPack({
    userId,
    packId,
    userEditedPack: parsed.userEditedPack,
  });
  res.status(200).json({ success: true, data });
}

import type { Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../lib/errors";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import {
  coreSessionIdParamSchema,
  createContentOutputSchema,
  createLongformSchema,
  createLearningSessionSchema,
  createQuizAttemptSchema,
  recordContentShareSchema,
  upsertLearningDnaSchema,
} from "./core.schema";
import {
  createContentOutputForSession,
  createLearningSession,
  createLongformOutputForSession,
  createQuizAttemptForSession,
  generateLessonForSession,
  getContentOutputsForSession,
  getLearningDna,
  getLearningSession,
  getLongformOutputForSession,
  recordContentShare,
  upsertLearningDna,
} from "./core.service";

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
  const authReq = req as AuthenticatedRequest & {
    user?: {
      sub?: string;
      userId?: string;
      id?: string;
    };
  };

  const userId =
    authReq.user?.userId ?? authReq.user?.sub ?? authReq.user?.id;

  if (!userId) {
    throw new AppError(401, "Unauthorized", {
      code: "AUTH_UNAUTHORIZED",
    });
  }

  return userId;
}

/**
 * Learning DNA
 */

export async function upsertDnaController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const body = parseOrThrow(() => upsertLearningDnaSchema.parse(req.body));

  const dna = await upsertLearningDna(userId, body);

  res.status(200).json({
    success: true,
    data: {
      dna,
    },
  });
}

export async function getDnaController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);

  const dna = await getLearningDna(userId);

  res.status(200).json({
    success: true,
    data: {
      dna,
    },
  });
}

/**
 * Learning Sessions
 */

export async function createSessionController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const body = parseOrThrow(() => createLearningSessionSchema.parse(req.body));

  const session = await createLearningSession(userId, body);

  res.status(201).json({
    success: true,
    data: {
      session,
    },
  });
}

export async function getSessionController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const params = parseOrThrow(() => coreSessionIdParamSchema.parse(req.params));

  const session = await getLearningSession(userId, params.id);

  res.status(200).json({
    success: true,
    data: {
      session,
    },
  });
}

/**
 * Lesson Generation
 */

export async function generateSessionLessonController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const params = parseOrThrow(() => coreSessionIdParamSchema.parse(req.params));

  const generated = await generateLessonForSession(userId, params.id);

  res.status(200).json({
    success: true,
    data: generated,
  });
}

/**
 * Quiz Attempts
 */

export async function createQuizAttemptController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const params = parseOrThrow(() => coreSessionIdParamSchema.parse(req.params));
  const body = parseOrThrow(() => createQuizAttemptSchema.parse(req.body));

  const result = await createQuizAttemptForSession(userId, params.id, body);

  res.status(201).json({
    success: true,
    data: result,
  });
}

/**
 * Content Outputs
 */

export async function createContentOutputController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const params = parseOrThrow(() => coreSessionIdParamSchema.parse(req.params));
  const body = parseOrThrow(() => createContentOutputSchema.parse(req.body));

  const output = await createContentOutputForSession(userId, params.id, body);

  res.status(201).json({
    success: true,
    data: {
      output,
    },
  });
}

export async function getSessionOutputsController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const params = parseOrThrow(() => coreSessionIdParamSchema.parse(req.params));

  const outputs = await getContentOutputsForSession(userId, params.id);

  res.status(200).json({
    success: true,
    data: {
      outputs,
    },
  });
}

/**
 * Long-form academic video scripts
 */

export async function createLongformOutputController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const params = parseOrThrow(() => coreSessionIdParamSchema.parse(req.params));
  const body = parseOrThrow(() => createLongformSchema.parse(req.body));

  const data = await createLongformOutputForSession(userId, params.id, body);

  res.status(201).json({
    success: true,
    data,
  });
}

export async function getLongformOutputController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const params = parseOrThrow(() => coreSessionIdParamSchema.parse(req.params));

  const data = await getLongformOutputForSession(userId, params.id);

  res.status(200).json({
    success: true,
    data,
  });
}

/**
 * Content share tracking (viral)
 */
export async function recordContentShareController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = getUserId(req);
  const params = parseOrThrow(() => coreSessionIdParamSchema.parse(req.params));
  const body = parseOrThrow(() => recordContentShareSchema.parse(req.body));

  const data = await recordContentShare(userId, params.id, body);

  res.status(200).json({
    success: true,
    data,
  });
}
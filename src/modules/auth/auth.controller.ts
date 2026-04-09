import type { Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../lib/errors";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { loginBodySchema, registerBodySchema } from "./auth.schema";
import { getCurrentUser, loginUser, registerUser } from "./auth.service";

function zodToAppError(error: ZodError): AppError {
  return new AppError(400, "Request validation failed", {
    code: "VALIDATION_ERROR",
    details: error.flatten().fieldErrors,
  });
}

export async function registerController(req: Request, res: Response): Promise<void> {
  let body;
  try {
    body = registerBodySchema.parse(req.body);
  } catch (error) {
    if (error instanceof ZodError) throw zodToAppError(error);
    throw error;
  }

  const data = await registerUser(body);
  res.status(201).json({
    success: true,
    data,
  });
}

export async function loginController(req: Request, res: Response): Promise<void> {
  let body;
  try {
    body = loginBodySchema.parse(req.body);
  } catch (error) {
    if (error instanceof ZodError) throw zodToAppError(error);
    throw error;
  }

  const data = await loginUser(body);
  res.status(200).json({
    success: true,
    data,
  });
}

export async function meController(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const user = await getCurrentUser(authReq.user.sub);
  res.status(200).json({
    success: true,
    data: { user },
  });
}

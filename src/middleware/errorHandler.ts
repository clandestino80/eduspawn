import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors";

function safeMessage(err: unknown, isProduction: boolean): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) {
    if (isProduction) return "An unexpected error occurred";
    return err.message;
  }
  return "An unexpected error occurred";
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isProduction = process.env.NODE_ENV === "production";

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  const statusCode = 500;
  const body: Record<string, unknown> = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: safeMessage(err, isProduction),
    },
  };

  if (!isProduction && err instanceof Error && err.stack) {
    body.error = {
      ...(body.error as object),
      stack: err.stack,
    };
  }

  if (isProduction) {
    console.error("[unhandled]", req.method, req.originalUrl, err);
  } else {
    console.error(err);
  }

  res.status(statusCode).json(body);
}

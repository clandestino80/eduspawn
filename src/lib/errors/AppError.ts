export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly isOperational: boolean;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    message: string,
    options?: {
      code?: string;
      cause?: unknown;
      details?: unknown;
      isOperational?: boolean;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = options?.code ?? "APP_ERROR";
    this.isOperational = options?.isOperational ?? true;
    this.details = options?.details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

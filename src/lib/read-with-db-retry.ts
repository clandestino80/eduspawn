import { setTimeout as delay } from "node:timers/promises";
import { getPrismaErrorLogFields, isTransientPrismaConnectionError } from "./prisma-transient";

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 50;

/**
 * Bounded retries for read-only Prisma work (e.g. Knowledge Engine debug reads).
 * Does not retry non-transient errors or on the last attempt.
 */
export async function withReadDbRetry<T>(
  operationLabel: string,
  fn: () => Promise<T>,
  context: Record<string, unknown>,
  options?: { maxAttempts?: number },
): Promise<T> {
  const maxAttempts = Math.min(
    5,
    Math.max(1, options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
  );
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const transient = isTransientPrismaConnectionError(error);
      if (!transient || attempt === maxAttempts) {
        if (transient && attempt === maxAttempts) {
          console.error("[db_read_retry_exhausted]", {
            operationLabel,
            attempt,
            maxAttempts,
            ...context,
            ...getPrismaErrorLogFields(error),
          });
        }
        throw error;
      }

      const waitMs = BASE_DELAY_MS * attempt;
      console.warn("[db_read_retry]", {
        operationLabel,
        attempt,
        maxAttempts,
        nextDelayMs: waitMs,
        ...context,
        ...getPrismaErrorLogFields(error),
      });
      await delay(waitMs);
    }
  }

  throw lastError;
}

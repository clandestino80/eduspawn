import { Prisma } from "@prisma/client";

/**
 * Operational classification for RDS / pool blips (P1001 reachability, P1017 closed connection, etc.).
 * Used for logging and 503-style responses; does not change write semantics.
 */
export function isTransientPrismaConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return (
      error.code === "P1001" ||
      error.code === "P1017" ||
      error.code === "P1008" ||
      error.code === "P1011"
    );
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return looksLikeDriverConnectionMessage(error.message);
  }

  if (error instanceof Error) {
    return looksLikeDriverConnectionMessage(error.message);
  }

  return false;
}

function looksLikeDriverConnectionMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("econnrefused") ||
    m.includes("connection reset") ||
    m.includes("server closed the connection") ||
    m.includes("connection terminated") ||
    m.includes("ssl connection has been closed") ||
    m.includes("ssl syscall error") ||
    m.includes("broken pipe") ||
    m.includes("can't reach database server")
  );
}

/**
 * Safe structured fields for logs (no secrets).
 */
export function getPrismaErrorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      prismaKind: "PrismaClientKnownRequestError",
      prismaCode: error.code,
      prismaMeta: error.meta,
    };
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      prismaKind: "PrismaClientInitializationError",
      prismaErrorCode: error.errorCode,
    };
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return {
      prismaKind: "PrismaClientUnknownRequestError",
      messageHead: error.message.slice(0, 200),
    };
  }
  if (error instanceof Error) {
    return {
      prismaKind: error.name,
      messageHead: error.message.slice(0, 200),
    };
  }
  return { prismaKind: typeof error };
}

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Single PrismaClient for the process. Pool sizing / timeouts for AWS RDS are usually
 * controlled via `DATABASE_URL` query params, e.g. `connection_limit`, `pool_timeout`,
 * `connect_timeout`, and `sslmode` (see env validation in `config/env.ts`).
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

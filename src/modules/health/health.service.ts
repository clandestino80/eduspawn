import { prisma } from "../../lib/prisma";

export type HealthStatus = "ok" | "degraded";

export async function getHealthSnapshot(): Promise<{
  status: HealthStatus;
  database: "up" | "down";
  timestamp: string;
}> {
  const timestamp = new Date().toISOString();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "up", timestamp };
  } catch {
    return { status: "degraded", database: "down", timestamp };
  }
}

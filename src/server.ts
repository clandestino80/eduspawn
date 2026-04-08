import "dotenv/config";
import { createServer } from "node:http";
import { loadEnv } from "./config/env";
import { createApp } from "./app";
import { prisma } from "./lib/prisma";

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}, shutting down…`);
  try {
    await prisma.$disconnect();
  } catch (e) {
    console.error("Error disconnecting Prisma", e);
  }
  process.exit(0);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = createApp();
  const server = createServer(app);

  server.listen(env.PORT, () => {
    console.info(`EduSpawn API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("Fatal startup error", e);
  process.exit(1);
});

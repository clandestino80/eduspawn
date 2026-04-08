import compression from "compression";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { loadEnv } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFound";
import { registerRoutes } from "./routes";

export function createApp(): Express {
  const env = loadEnv();

  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  const corsOrigin =
    env.CORS_ORIGIN === undefined
      ? true
      : env.CORS_ORIGIN.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    morgan(env.NODE_ENV === "production" ? "combined" : "dev", {
      skip: (req) =>
        req.url === "/health" || req.url === "/api/v1/health" || req.url.startsWith("/health?"),
    }),
  );

  registerRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

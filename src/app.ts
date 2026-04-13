import compression from "compression";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { loadEnv } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFound";
import { coreRouter } from "./modules/core/core.route";
import { stripeBillingWebhookRouter } from "./modules/entitlements/billing-webhooks.routes";
import { registerRoutes } from "./routes";

export function createApp(): Express {
  const env = loadEnv();

  const app = express();

  if (env.TRUST_PROXY_HOPS > 0) {
    app.set("trust proxy", env.TRUST_PROXY_HOPS);
  }

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
  /** Stripe webhooks must see the raw body for signature verification (before JSON parser). */
  app.use(
    "/api/v1/billing/webhooks/stripe",
    express.raw({ type: "application/json", limit: "1mb" }),
    stripeBillingWebhookRouter,
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    morgan(env.NODE_ENV === "production" ? "combined" : "dev", {
      skip: (req) =>
        req.url === "/health" || req.url === "/api/v1/health" || req.url.startsWith("/health?"),
    }),
  );

  app.use("/core", coreRouter);
  registerRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

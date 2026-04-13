import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getEnv } from "../config/env";
import { AppError } from "../lib/errors";
import { getSlidingWindowLimiter } from "../lib/in-memory-rate-limiter";
import { logProductEvent } from "../lib/product-log";
import { getInboundRequestIp } from "../lib/request-ip";
import type { AuthenticatedRequest } from "./auth.middleware";

type RateConfig = { windowMs: number; max: number };

function shouldApplyRateLimit(): boolean {
  return getEnv().RATE_LIMITING_ENABLED;
}

export function rateLimitPerAuthenticatedUser(bucket: string, getConfig: () => RateConfig): RequestHandler {
  const limiter = getSlidingWindowLimiter(`user:${bucket}`);
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!shouldApplyRateLimit()) {
      next();
      return;
    }
    const { windowMs, max } = getConfig();
    if (max <= 0) {
      next();
      return;
    }
    const authReq = req as AuthenticatedRequest;
    const sub = authReq.user?.sub?.trim();
    if (!sub) {
      next(new AppError(401, "Unauthorized", { code: "AUTH_UNAUTHORIZED" }));
      return;
    }
    const key = `${bucket}:${sub}`;
    const r = limiter.tryConsume(key, windowMs, max);
    if (!r.ok) {
      logProductEvent("rate_limit_denied", {
        bucket,
        userId: sub,
        path: req.originalUrl,
        method: req.method,
        retryAfterSec: r.retryAfterSec,
      });
      next(
        new AppError(429, "Too many requests. Please slow down and try again shortly.", {
          code: "RATE_LIMITED",
          details: { retryAfterSec: r.retryAfterSec, bucket },
        }),
      );
      return;
    }
    next();
  };
}

export function rateLimitPerIp(bucket: string, getConfig: () => RateConfig): RequestHandler {
  const limiter = getSlidingWindowLimiter(`ip:${bucket}`);
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!shouldApplyRateLimit()) {
      next();
      return;
    }
    const { windowMs, max } = getConfig();
    if (max <= 0) {
      next();
      return;
    }
    const ip = getInboundRequestIp(req);
    const key = `${bucket}:${ip}`;
    const r = limiter.tryConsume(key, windowMs, max);
    if (!r.ok) {
      logProductEvent("rate_limit_denied", {
        bucket,
        ip,
        path: req.originalUrl,
        method: req.method,
        retryAfterSec: r.retryAfterSec,
      });
      next(
        new AppError(429, "Too many requests. Please slow down and try again shortly.", {
          code: "RATE_LIMITED",
          details: { retryAfterSec: r.retryAfterSec, bucket },
        }),
      );
      return;
    }
    next();
  };
}

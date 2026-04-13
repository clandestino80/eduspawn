import type { NextFunction, Request, Response } from "express";
import { getEnv } from "../config/env";
import { AppError } from "../lib/errors";
import type { JwtPayload } from "../lib/jwt";
import type { AuthenticatedRequest } from "./auth.middleware";

function splitCommaList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * True when the JWT subject or email is explicitly allow-listed for knowledge-engine maintenance routes.
 * If both env lists are empty, no one is allowed (deny-by-default for ops).
 */
export function isKnowledgeOpsOperator(payload: JwtPayload): boolean {
  const env = getEnv();
  const ids = new Set(splitCommaList(env.KNOWLEDGE_OPS_ALLOWED_USER_IDS));
  const emails = new Set(
    splitCommaList(env.KNOWLEDGE_OPS_ALLOWED_EMAILS).map((e) => e.toLowerCase()),
  );
  if (ids.size === 0 && emails.size === 0) {
    return false;
  }
  if (ids.has(payload.sub)) {
    return true;
  }
  const mail = payload.email.trim().toLowerCase();
  if (mail.length > 0 && emails.has(mail)) {
    return true;
  }
  return false;
}

/**
 * After `requireAuth`: only allow-listed operators may proceed (403 otherwise).
 */
export function requireKnowledgeOps(req: Request, _res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  const user = authReq.user;
  if (!user?.sub) {
    next(new AppError(401, "Unauthorized", { code: "AUTH_UNAUTHORIZED" }));
    return;
  }
  if (!isKnowledgeOpsOperator(user)) {
    console.warn("[ke_ops]", {
      event: "auth_denied",
      path: req.originalUrl,
      method: req.method,
      sub: user.sub,
      email: user.email,
    });
    next(
      new AppError(403, "Knowledge engine ops access denied", {
        code: "KNOWLEDGE_OPS_FORBIDDEN",
        details: {
          hint: "Ask an administrator to add your user id or email to KNOWLEDGE_OPS_ALLOWED_USER_IDS or KNOWLEDGE_OPS_ALLOWED_EMAILS.",
        },
      }),
    );
    return;
  }
  console.info("[ke_ops]", {
    event: "auth_ok",
    path: req.originalUrl,
    method: req.method,
    sub: user.sub,
  });
  next();
}

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
 * True when JWT subject or email is allow-listed for billing/entitlement ops routes.
 * Deny-by-default when both env lists are empty (same posture as knowledge ops).
 */
export function isBillingOpsOperator(payload: JwtPayload): boolean {
  const env = getEnv();
  const ids = new Set(splitCommaList(env.BILLING_OPS_ALLOWED_USER_IDS));
  const emails = new Set(
    splitCommaList(env.BILLING_OPS_ALLOWED_EMAILS).map((e) => e.toLowerCase()),
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

/** After `requireAuth`: only billing-ops allow-listed operators (403 otherwise). */
export function requireBillingOps(req: Request, _res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  const user = authReq.user;
  if (!user?.sub) {
    next(new AppError(401, "Unauthorized", { code: "AUTH_UNAUTHORIZED" }));
    return;
  }
  if (!isBillingOpsOperator(user)) {
    console.warn("[billing_ops]", {
      event: "auth_denied",
      path: req.originalUrl,
      method: req.method,
      sub: user.sub,
    });
    next(
      new AppError(403, "Billing ops access denied", {
        code: "BILLING_OPS_FORBIDDEN",
        details: {
          hint: "Add your JWT sub or email to BILLING_OPS_ALLOWED_USER_IDS or BILLING_OPS_ALLOWED_EMAILS.",
        },
      }),
    );
    return;
  }
  console.info("[billing_ops]", {
    event: "auth_ok",
    path: req.originalUrl,
    method: req.method,
    sub: user.sub,
  });
  next();
}

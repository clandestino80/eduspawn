import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import { verifyAccessToken, type JwtPayload } from "../lib/jwt";

export type AuthenticatedRequest = Request & {
  user: JwtPayload;
};

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    next(new AppError(401, "Missing or invalid authorization header", { code: "AUTH_UNAUTHORIZED" }));
    return;
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    next(new AppError(401, "Missing bearer token", { code: "AUTH_UNAUTHORIZED" }));
    return;
  }

  const payload = verifyAccessToken(token);
  (req as AuthenticatedRequest).user = payload;
  next();
}

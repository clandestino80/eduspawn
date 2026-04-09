import jwt, { type SignOptions } from "jsonwebtoken";
import { getEnv } from "../config/env";
import { AppError } from "./errors";

export type JwtPayload = {
  sub: string;
  email: string;
  username: string;
};

export function signAccessToken(payload: JwtPayload): string {
  const env = getEnv();
  const expiresIn = (env.JWT_EXPIRES_IN ?? "7d") as NonNullable<SignOptions["expiresIn"]>;
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    const env = getEnv();
    const decoded = jwt.verify(token, env.JWT_SECRET);

    if (typeof decoded !== "object" || decoded === null) {
      throw new AppError(401, "Invalid access token", { code: "AUTH_UNAUTHORIZED" });
    }

    const payload = decoded as Partial<JwtPayload>;
    if (!payload.sub || !payload.email || !payload.username) {
      throw new AppError(401, "Invalid access token", { code: "AUTH_UNAUTHORIZED" });
    }

    return {
      sub: payload.sub,
      email: payload.email,
      username: payload.username,
    };
  } catch {
    throw new AppError(401, "Invalid or expired access token", { code: "AUTH_UNAUTHORIZED" });
  }
}

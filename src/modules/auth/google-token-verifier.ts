import { OAuth2Client } from "google-auth-library";
import type { TokenPayload } from "google-auth-library";
import { getEnv } from "../../config/env";
import { AppError } from "../../lib/errors";

export type VerifiedGoogleIdentity = {
  sub: string;
  email: string;
  name: string | null;
};

let googleClientSingleton: OAuth2Client | null = null;

function getGoogleClient(): OAuth2Client {
  if (!googleClientSingleton) {
    googleClientSingleton = new OAuth2Client();
  }
  return googleClientSingleton;
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
  const clientId = getEnv().GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new AppError(503, "Google sign-in is not configured", { code: "AUTH_PROVIDER_NOT_CONFIGURED" });
  }

  let payload: TokenPayload | undefined;
  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken,
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(401, "Invalid Google identity token", { code: "AUTH_UNAUTHORIZED" });
  }

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new AppError(401, "Invalid Google identity token", { code: "AUTH_UNAUTHORIZED" });
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name?.trim() ? payload.name.trim() : null,
  };
}

import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/errors";
import { signAccessToken } from "../../lib/jwt";
import type { GoogleAuthBody, LoginBody, RegisterBody } from "./auth.schema";
import { verifyGoogleIdToken, type VerifiedGoogleIdentity } from "./google-token-verifier";

const SALT_ROUNDS = 12;

type SafeUser = {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
};

type AuthResponse = {
  token: string;
  user: SafeUser;
};

type GoogleIdentityVerifier = (idToken: string) => Promise<VerifiedGoogleIdentity>;

function toSafeUser(user: {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
}): SafeUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function toAuthResponse(user: SafeUser): AuthResponse {
  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    username: user.username,
  });
  return { token, user };
}

function normalizeUsernameSeed(input: string): string {
  const s = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return s.length >= 3 ? s : "user";
}

async function ensureUniqueUsername(base: string): Promise<string> {
  const normalized = normalizeUsernameSeed(base);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? normalized : `${normalized}_${i + 1}`;
    const exists = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!exists) {
      return candidate;
    }
  }
  throw new AppError(500, "Unable to allocate username", { code: "INTERNAL_ERROR" });
}

export async function registerUser(input: RegisterBody): Promise<AuthResponse> {
  const email = input.email.toLowerCase();
  const username = input.username.trim();

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username }],
    },
    select: { id: true, email: true, username: true },
  });

  if (existing?.email === email) {
    throw new AppError(400, "Email is already in use", { code: "VALIDATION_ERROR" });
  }
  if (existing?.username === username) {
    throw new AppError(400, "Username is already in use", { code: "VALIDATION_ERROR" });
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      username: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const safeUser = toSafeUser(user);
  return toAuthResponse(safeUser);
}

export async function loginUser(input: LoginBody): Promise<AuthResponse> {
  const email = input.email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      username: true,
      passwordHash: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user?.passwordHash) {
    throw new AppError(401, "Invalid email or password", { code: "AUTH_UNAUTHORIZED" });
  }

  const isValid = await bcrypt.compare(input.password, user.passwordHash);
  if (!isValid) {
    throw new AppError(401, "Invalid email or password", { code: "AUTH_UNAUTHORIZED" });
  }

  const safeUser = toSafeUser(user);
  return toAuthResponse(safeUser);
}

export async function authenticateWithGoogle(
  input: GoogleAuthBody,
  deps?: { verifyIdentity?: GoogleIdentityVerifier },
): Promise<AuthResponse> {
  const verifyIdentity = deps?.verifyIdentity ?? verifyGoogleIdToken;
  const identity = await verifyIdentity(input.idToken);

  const linkedByGoogle = await prisma.user.findUnique({
    where: { googleSub: identity.sub },
    select: {
      id: true,
      email: true,
      username: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (linkedByGoogle) {
    return toAuthResponse(toSafeUser(linkedByGoogle));
  }

  const userByEmail = await prisma.user.findUnique({
    where: { email: identity.email },
    select: {
      id: true,
      email: true,
      username: true,
      googleSub: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (userByEmail) {
    if (userByEmail.googleSub && userByEmail.googleSub !== identity.sub) {
      throw new AppError(409, "Email is already linked to another Google account", {
        code: "AUTH_CONFLICT",
      });
    }
    const linked = await prisma.user.update({
      where: { id: userByEmail.id },
      data: { googleSub: identity.sub },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return toAuthResponse(toSafeUser(linked));
  }

  const usernameSeed = identity.name ?? identity.email.split("@")[0] ?? "user";
  const username = await ensureUniqueUsername(usernameSeed);
  const created = await prisma.user.create({
    data: {
      email: identity.email,
      username,
      googleSub: identity.sub,
      passwordHash: null,
    },
    select: {
      id: true,
      email: true,
      username: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return toAuthResponse(toSafeUser(created));
}

export async function getCurrentUser(userId: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new AppError(401, "User not found", { code: "AUTH_UNAUTHORIZED" });
  }

  return toSafeUser(user);
}

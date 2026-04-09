import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/errors";
import { signAccessToken } from "../../lib/jwt";
import type { LoginBody, RegisterBody } from "./auth.schema";

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
  const token = signAccessToken({
    sub: safeUser.id,
    email: safeUser.email,
    username: safeUser.username,
  });

  return { token, user: safeUser };
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
  const token = signAccessToken({
    sub: safeUser.id,
    email: safeUser.email,
    username: safeUser.username,
  });

  return { token, user: safeUser };
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

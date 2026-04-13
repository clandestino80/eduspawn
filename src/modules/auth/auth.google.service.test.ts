import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { resetEnvCacheForTests } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/errors";
import { authenticateWithGoogle } from "./auth.service";

const JWT_SECRET = "g".repeat(32);
const DATABASE_URL = "postgresql://u:p@127.0.0.1:6543/eduspawn_test?sslmode=require";

function applyTestEnv(): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  resetEnvCacheForTests();
}

type UserFindUnique = typeof prisma.user.findUnique;
type UserUpdate = typeof prisma.user.update;
type UserCreate = typeof prisma.user.create;

test("authenticateWithGoogle", async (t) => {
  await t.test("existing Google-linked user signs in", async () => {
    applyTestEnv();
    const userApi = prisma.user as unknown as {
      findUnique: UserFindUnique;
      update: UserUpdate;
      create: UserCreate;
    };
    const originalFindUnique = userApi.findUnique.bind(userApi);
    const originalUpdate = userApi.update.bind(userApi);
    const originalCreate = userApi.create.bind(userApi);

    userApi.findUnique = (async (args: Prisma.UserFindUniqueArgs) => {
      if ("googleSub" in args.where && args.where.googleSub === "google-sub-1") {
        return {
          id: "user-google-1",
          email: "linked@example.com",
          username: "linked_user",
          createdAt: new Date("2026-04-01T00:00:00.000Z"),
          updatedAt: new Date("2026-04-01T00:00:00.000Z"),
        } as Awaited<ReturnType<UserFindUnique>>;
      }
      return null as Awaited<ReturnType<UserFindUnique>>;
    }) as unknown as UserFindUnique;
    userApi.update = (async () => {
      throw new Error("update should not be called for existing googleSub");
    }) as unknown as UserUpdate;
    userApi.create = (async () => {
      throw new Error("create should not be called for existing googleSub");
    }) as unknown as UserCreate;

    try {
      const result = await authenticateWithGoogle(
        { idToken: "google-id-token" },
        {
          verifyIdentity: async () => ({
            sub: "google-sub-1",
            email: "linked@example.com",
            name: "Linked User",
          }),
        },
      );
      assert.equal(result.user.id, "user-google-1");
      assert.equal(result.user.email, "linked@example.com");
      assert.equal(typeof result.token, "string");
      assert.ok(result.token.length > 20);
    } finally {
      userApi.findUnique = originalFindUnique;
      userApi.update = originalUpdate;
      userApi.create = originalCreate;
    }
  });

  await t.test("email match links googleSub and signs in", async () => {
    applyTestEnv();
    const userApi = prisma.user as unknown as {
      findUnique: UserFindUnique;
      update: UserUpdate;
      create: UserCreate;
    };
    const originalFindUnique = userApi.findUnique.bind(userApi);
    const originalUpdate = userApi.update.bind(userApi);
    const originalCreate = userApi.create.bind(userApi);

    userApi.findUnique = (async (args: Prisma.UserFindUniqueArgs) => {
      if ("googleSub" in args.where) {
        return null as Awaited<ReturnType<UserFindUnique>>;
      }
      if ("email" in args.where && args.where.email === "existing@example.com") {
        return {
          id: "user-email-1",
          email: "existing@example.com",
          username: "existing_user",
          googleSub: null,
          createdAt: new Date("2026-04-01T00:00:00.000Z"),
          updatedAt: new Date("2026-04-01T00:00:00.000Z"),
        } as Awaited<ReturnType<UserFindUnique>>;
      }
      return null as Awaited<ReturnType<UserFindUnique>>;
    }) as unknown as UserFindUnique;
    userApi.update = (async (args: Prisma.UserUpdateArgs) => {
      assert.equal(args.where.id, "user-email-1");
      assert.equal(args.data.googleSub, "google-sub-link");
      return {
        id: "user-email-1",
        email: "existing@example.com",
        username: "existing_user",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      } as Awaited<ReturnType<UserUpdate>>;
    }) as unknown as UserUpdate;
    userApi.create = (async () => {
      throw new Error("create should not be called for email-link path");
    }) as unknown as UserCreate;

    try {
      const result = await authenticateWithGoogle(
        { idToken: "google-id-token" },
        {
          verifyIdentity: async () => ({
            sub: "google-sub-link",
            email: "existing@example.com",
            name: "Existing User",
          }),
        },
      );
      assert.equal(result.user.id, "user-email-1");
      assert.equal(result.user.email, "existing@example.com");
      assert.equal(typeof result.token, "string");
      assert.ok(result.token.length > 20);
    } finally {
      userApi.findUnique = originalFindUnique;
      userApi.update = originalUpdate;
      userApi.create = originalCreate;
    }
  });

  await t.test("new Google user is created and signs in", async () => {
    applyTestEnv();
    const userApi = prisma.user as unknown as {
      findUnique: UserFindUnique;
      update: UserUpdate;
      create: UserCreate;
    };
    const originalFindUnique = userApi.findUnique.bind(userApi);
    const originalUpdate = userApi.update.bind(userApi);
    const originalCreate = userApi.create.bind(userApi);

    userApi.findUnique = (async (args: Prisma.UserFindUniqueArgs) => {
      if ("googleSub" in args.where) {
        return null as Awaited<ReturnType<UserFindUnique>>;
      }
      if ("email" in args.where) {
        return null as Awaited<ReturnType<UserFindUnique>>;
      }
      if ("username" in args.where) {
        return null as Awaited<ReturnType<UserFindUnique>>;
      }
      return null as Awaited<ReturnType<UserFindUnique>>;
    }) as unknown as UserFindUnique;
    userApi.update = (async () => {
      throw new Error("update should not be called for create path");
    }) as unknown as UserUpdate;
    userApi.create = (async (args: Prisma.UserCreateArgs) => {
      assert.equal(args.data.email, "newuser@example.com");
      assert.equal(args.data.googleSub, "google-sub-new");
      assert.equal(typeof args.data.username, "string");
      return {
        id: "user-new-1",
        email: "newuser@example.com",
        username: String(args.data.username),
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      } as Awaited<ReturnType<UserCreate>>;
    }) as unknown as UserCreate;

    try {
      const result = await authenticateWithGoogle(
        { idToken: "google-id-token" },
        {
          verifyIdentity: async () => ({
            sub: "google-sub-new",
            email: "newuser@example.com",
            name: "New User",
          }),
        },
      );
      assert.equal(result.user.id, "user-new-1");
      assert.equal(result.user.email, "newuser@example.com");
      assert.equal(typeof result.token, "string");
      assert.ok(result.token.length > 20);
    } finally {
      userApi.findUnique = originalFindUnique;
      userApi.update = originalUpdate;
      userApi.create = originalCreate;
    }
  });

  await t.test("invalid token is rejected", async () => {
    applyTestEnv();
    await assert.rejects(
      () =>
        authenticateWithGoogle(
          { idToken: "invalid-id-token" },
          {
            verifyIdentity: async () => {
              throw new AppError(401, "Invalid Google identity token", { code: "AUTH_UNAUTHORIZED" });
            },
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 401);
        assert.equal(error.code, "AUTH_UNAUTHORIZED");
        return true;
      },
    );
  });
});

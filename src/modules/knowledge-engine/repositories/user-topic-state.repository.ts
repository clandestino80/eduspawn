import { UserTopicInteractionType, type Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import type { GlobalTopicInventoryFeedRow } from "./global-topic-inventory.repository";

const feedStateSelect = {
  globalTopicId: true,
  generatedAt: true,
  dismissedAt: true,
  openedAt: true,
  savedAt: true,
  lastSeenAt: true,
  firstSeenAt: true,
  seenCount: true,
  lastInteractionType: true,
} as const;

export type UserTopicStateFeedProjection = Prisma.UserTopicStateGetPayload<{
  select: typeof feedStateSelect;
}>;

/**
 * Per-user topic states for feed exclusion (read-only, bounded `in` list).
 */
export async function findUserTopicStatesForTopicIds(params: {
  userId: string;
  topicIds: readonly string[];
}): Promise<UserTopicStateFeedProjection[]> {
  if (params.topicIds.length === 0) {
    return [];
  }
  return prisma.userTopicState.findMany({
    where: {
      userId: params.userId,
      globalTopicId: { in: [...params.topicIds] },
    },
    select: feedStateSelect,
  });
}

const savedListInventoryInclude = {
  globalConcept: {
    select: {
      slug: true,
      displayTitle: true,
      article: { select: { summary: true, hook: true } },
    },
  },
} as const;

/**
 * User’s explicitly saved inventory topics, newest save first (read-only).
 */
export async function findUserSavedTopicsWithInventory(params: {
  userId: string;
  take: number;
}): Promise<{ savedAt: Date; inventory: GlobalTopicInventoryFeedRow }[]> {
  const rows = await prisma.userTopicState.findMany({
    where: { userId: params.userId, savedAt: { not: null } },
    orderBy: { savedAt: "desc" },
    take: params.take,
    include: {
      globalTopic: { include: savedListInventoryInclude },
    },
  });
  return rows
    .filter((r): r is (typeof r & { savedAt: Date }) => r.savedAt != null)
    .map((r) => ({
      savedAt: r.savedAt,
      inventory: r.globalTopic as GlobalTopicInventoryFeedRow,
    }));
}

/** Slice F — explicit interaction writes (POST handlers / promotion hook only). */

export async function upsertUserTopicOpened(params: { userId: string; globalTopicId: string }): Promise<void> {
  const { userId, globalTopicId } = params;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const ex = await tx.userTopicState.findUnique({
      where: { userId_globalTopicId: { userId, globalTopicId } },
    });
    if (!ex) {
      await tx.userTopicState.create({
        data: {
          userId,
          globalTopicId,
          firstSeenAt: now,
          lastSeenAt: now,
          openedAt: now,
          lastInteractionType: UserTopicInteractionType.OPENED,
        },
      });
      return;
    }
    await tx.userTopicState.update({
      where: { userId_globalTopicId: { userId, globalTopicId } },
      data: {
        firstSeenAt: ex.firstSeenAt ?? now,
        lastSeenAt: now,
        openedAt: ex.openedAt ?? now,
        lastInteractionType: UserTopicInteractionType.OPENED,
      },
    });
  });
}

export async function upsertUserTopicDismissed(params: { userId: string; globalTopicId: string }): Promise<void> {
  const { userId, globalTopicId } = params;
  const now = new Date();
  await prisma.userTopicState.upsert({
    where: { userId_globalTopicId: { userId, globalTopicId } },
    create: {
      userId,
      globalTopicId,
      dismissedAt: now,
      lastInteractionType: UserTopicInteractionType.DISMISSED,
    },
    update: {
      dismissedAt: now,
      lastInteractionType: UserTopicInteractionType.DISMISSED,
    },
  });
}

export async function upsertUserTopicSaved(params: { userId: string; globalTopicId: string }): Promise<void> {
  const { userId, globalTopicId } = params;
  const now = new Date();
  await prisma.userTopicState.upsert({
    where: { userId_globalTopicId: { userId, globalTopicId } },
    create: {
      userId,
      globalTopicId,
      savedAt: now,
      lastInteractionType: UserTopicInteractionType.SAVED,
    },
    update: {
      savedAt: now,
      lastInteractionType: UserTopicInteractionType.SAVED,
    },
  });
}

/**
 * Clears `savedAt` only. Preserves opened/dismissed/generated/seen fields.
 * Idempotent: no-op if row missing or already not saved.
 */
export async function clearUserTopicSaved(params: {
  userId: string;
  globalTopicId: string;
}): Promise<void> {
  const { userId, globalTopicId } = params;
  const ex = await prisma.userTopicState.findUnique({
    where: { userId_globalTopicId: { userId, globalTopicId } },
  });
  if (!ex || ex.savedAt == null) {
    return;
  }
  await prisma.userTopicState.update({
    where: { userId_globalTopicId: { userId, globalTopicId } },
    data: {
      savedAt: null,
      ...(ex.lastInteractionType === UserTopicInteractionType.SAVED
        ? { lastInteractionType: null }
        : {}),
    },
  });
}

export async function upsertUserTopicSeen(params: { userId: string; globalTopicId: string }): Promise<void> {
  const { userId, globalTopicId } = params;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const ex = await tx.userTopicState.findUnique({
      where: { userId_globalTopicId: { userId, globalTopicId } },
    });
    if (!ex) {
      await tx.userTopicState.create({
        data: {
          userId,
          globalTopicId,
          firstSeenAt: now,
          lastSeenAt: now,
          lastInteractionType: UserTopicInteractionType.SEEN,
          seenCount: 1,
        },
      });
      return;
    }
    await tx.userTopicState.update({
      where: { userId_globalTopicId: { userId, globalTopicId } },
      data: {
        firstSeenAt: ex.firstSeenAt ?? now,
        lastSeenAt: now,
        lastInteractionType: UserTopicInteractionType.SEEN,
        seenCount: { increment: 1 },
      },
    });
  });
}

export async function upsertUserTopicGenerated(params: { userId: string; globalTopicId: string }): Promise<void> {
  const { userId, globalTopicId } = params;
  const now = new Date();
  await prisma.userTopicState.upsert({
    where: { userId_globalTopicId: { userId, globalTopicId } },
    create: {
      userId,
      globalTopicId,
      generatedAt: now,
      lastInteractionType: UserTopicInteractionType.GENERATED,
    },
    update: {
      generatedAt: now,
      lastInteractionType: UserTopicInteractionType.GENERATED,
    },
  });
}

import { Prisma } from "@prisma/client";
import type { CreatorPackKind } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export async function createUserCreatorPackRow(args: {
  userId: string;
  learningSessionId: string | null;
  requestJson: Prisma.InputJsonValue;
  durationBand: string;
  packKind: CreatorPackKind;
  systemOriginalJson: Prisma.InputJsonValue;
  reusedFromGlobalId: string | null;
  linkedGlobalMemoryId: string | null;
  generationProvenanceJson: Prisma.InputJsonValue | null;
}): Promise<{ id: string }> {
  return prisma.userCreatorPack.create({
    data: {
      userId: args.userId,
      learningSessionId: args.learningSessionId,
      requestJson: args.requestJson,
      durationBand: args.durationBand,
      packKind: args.packKind,
      systemOriginalJson: args.systemOriginalJson,
      reusedFromGlobalId: args.reusedFromGlobalId,
      linkedGlobalMemoryId: args.linkedGlobalMemoryId,
      generationProvenanceJson: args.generationProvenanceJson ?? Prisma.DbNull,
    },
    select: { id: true },
  });
}

export async function findUserCreatorPackOwned(args: {
  userId: string;
  packId: string;
}): Promise<{
  id: string;
  packKind: CreatorPackKind;
  durationBand: string;
  requestJson: Prisma.JsonValue;
  systemOriginalJson: Prisma.JsonValue;
  userEditedJson: Prisma.JsonValue | null;
} | null> {
  return prisma.userCreatorPack.findFirst({
    where: { id: args.packId, userId: args.userId },
    select: {
      id: true,
      packKind: true,
      durationBand: true,
      requestJson: true,
      systemOriginalJson: true,
      userEditedJson: true,
    },
  });
}

export async function updateUserCreatorPackEditedJson(args: {
  packId: string;
  userId: string;
  userEditedJson: Prisma.InputJsonValue;
}): Promise<number> {
  const result = await prisma.userCreatorPack.updateMany({
    where: { id: args.packId, userId: args.userId },
    data: { userEditedJson: args.userEditedJson },
  });
  return result.count;
}

export async function setUserCreatorPackLinkedGlobalMemory(args: {
  packId: string;
  userId: string;
  globalMemoryId: string;
}): Promise<void> {
  await prisma.userCreatorPack.updateMany({
    where: { id: args.packId, userId: args.userId },
    data: { linkedGlobalMemoryId: args.globalMemoryId },
  });
}

/** Pack row for render pipeline (ownership + JSON payloads + provenance). */
export async function findUserCreatorPackForRender(args: {
  userId: string;
  packId: string;
}): Promise<{
  id: string;
  packKind: CreatorPackKind;
  learningSessionId: string | null;
  requestJson: Prisma.JsonValue;
  systemOriginalJson: Prisma.JsonValue;
  userEditedJson: Prisma.JsonValue | null;
} | null> {
  return prisma.userCreatorPack.findFirst({
    where: { id: args.packId, userId: args.userId },
    select: {
      id: true,
      packKind: true,
      learningSessionId: true,
      requestJson: true,
      systemOriginalJson: true,
      userEditedJson: true,
    },
  });
}

export async function countUserCreatorPacksCreatedSince(args: { userId: string; since: Date }): Promise<number> {
  return prisma.userCreatorPack.count({
    where: { userId: args.userId, createdAt: { gte: args.since } },
  });
}

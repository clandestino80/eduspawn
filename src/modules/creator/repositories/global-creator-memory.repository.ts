import type { CreatorGlobalMemoryPromotionStatus, CreatorPackKind, Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export async function findActiveGlobalCreatorMemoryByLookupKey(args: {
  lookupKey: string;
  packKind: CreatorPackKind;
}): Promise<{
  id: string;
  lookupKey: string;
  originalPackJson: Prisma.JsonValue;
  packKind: CreatorPackKind;
  promotionStatus: CreatorGlobalMemoryPromotionStatus;
} | null> {
  const row = await prisma.globalCreatorMemory.findFirst({
    where: {
      lookupKey: args.lookupKey,
      packKind: args.packKind,
      promotionStatus: "ACTIVE",
    },
    select: {
      id: true,
      lookupKey: true,
      originalPackJson: true,
      packKind: true,
      promotionStatus: true,
    },
  });
  return row;
}

export async function createGlobalCreatorMemoryRow(args: {
  lookupKey: string;
  keyFacetsJson: Prisma.InputJsonValue;
  packKind: CreatorPackKind;
  originalPackJson: Prisma.InputJsonValue;
  sourceUserId: string | null;
  provenanceJson: Prisma.InputJsonValue | null;
  schemaVersion?: number;
}): Promise<{ id: string }> {
  const row = await prisma.globalCreatorMemory.create({
    data: {
      lookupKey: args.lookupKey,
      keyFacetsJson: args.keyFacetsJson,
      packKind: args.packKind,
      originalPackJson: args.originalPackJson,
      schemaVersion: args.schemaVersion ?? 1,
      promotionStatus: "ACTIVE",
      sourceUserId: args.sourceUserId,
      provenanceJson: args.provenanceJson ?? undefined,
    },
    select: { id: true },
  });
  return row;
}

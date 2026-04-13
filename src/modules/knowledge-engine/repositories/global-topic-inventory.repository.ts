import type { Prisma } from "@prisma/client";
import { GlobalTopicSourceType, GlobalTopicStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

const articleSelect = {
  summary: true,
  hook: true,
} as const;

export type GlobalTopicInventoryFeedRow = Prisma.GlobalTopicInventoryGetPayload<{
  include: {
    globalConcept: {
      select: {
        slug: true;
        displayTitle: true;
        article: { select: typeof articleSelect };
      };
    };
  };
}>;

/**
 * Active, reusable inventory rows for the memory-first topic feed (read-only).
 * Ordering: quality (desc, nulls last) → recency → stable id tie-break.
 */
export async function findActiveReusableTopicsForFeed(params: {
  take: number;
  domain?: string;
  subdomain?: string;
}): Promise<GlobalTopicInventoryFeedRow[]> {
  const where: Prisma.GlobalTopicInventoryWhereInput = {
    status: GlobalTopicStatus.ACTIVE,
    reuseEligible: true,
  };
  const d = params.domain?.trim();
  const s = params.subdomain?.trim();
  if (d !== undefined && d.length > 0) {
    where.domain = d;
  }
  if (s !== undefined && s.length > 0) {
    where.subdomain = s;
  }

  return prisma.globalTopicInventory.findMany({
    where,
    include: {
      globalConcept: {
        select: {
          slug: true,
          displayTitle: true,
          article: { select: articleSelect },
        },
      },
    },
    orderBy: [
      { qualityScore: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "asc" },
    ],
    take: params.take,
  });
}

export async function countActiveReusableInventory(): Promise<number> {
  return prisma.globalTopicInventory.count({
    where: { status: GlobalTopicStatus.ACTIVE, reuseEligible: true },
  });
}

export async function countActiveDistinctDomains(): Promise<number> {
  const rows = await prisma.globalTopicInventory.findMany({
    where: {
      status: GlobalTopicStatus.ACTIVE,
      reuseEligible: true,
      domain: { not: null },
    },
    distinct: ["domain"],
    select: { domain: true },
  });
  return rows.filter((r) => (r.domain ?? "").trim().length > 0).length;
}

/** Any inventory row id (any status) — topic interaction APIs return 404 when missing. */
export async function findGlobalTopicInventoryIdExists(id: string): Promise<string | null> {
  const row = await prisma.globalTopicInventory.findUnique({
    where: { id },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function findExistingNormalizedKeys(keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) {
    return new Set();
  }
  const found = await prisma.globalTopicInventory.findMany({
    where: { normalizedKey: { in: [...keys] } },
    select: { normalizedKey: true },
  });
  return new Set(found.map((f) => f.normalizedKey));
}

export type GlobalTopicInventoryInsertRow = {
  normalizedKey: string;
  title: string;
  curiosityHook: string | null;
  shortSummary: string | null;
  domain: string | null;
  subdomain: string | null;
  microTopic: string | null;
  categoryLabel: string | null;
  sourceType: GlobalTopicSourceType;
  status: GlobalTopicStatus;
  qualityScore: number | null;
  reuseEligible: boolean;
  freshnessBucket: string | null;
  sourceUserId?: string | null;
  sourceLearningSessionId?: string | null;
  globalConceptId?: string | null;
};

/**
 * Bulk insert; relies on `normalizedKey` uniqueness — duplicates are skipped (no throw).
 */
export async function insertGlobalTopicInventoryMany(
  rows: readonly GlobalTopicInventoryInsertRow[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const res = await prisma.globalTopicInventory.createMany({
    data: [...rows],
    skipDuplicates: true,
  });
  return res.count;
}

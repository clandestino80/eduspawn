import type { LearningSession } from "@prisma/client";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";

export type LearningSessionListItemDto = {
  id: string;
  topic: string;
  curiosityPrompt: string;
  difficulty: string | null;
  tone: string | null;
  status: string;
  lessonTitle: string | null;
  lessonSummary: string | null;
  sourceGlobalTopicId: string | null;
  createdAt: string;
  updatedAt: string;
  /** True when there is enough generated material to open the lesson reader meaningfully. */
  lessonReady: boolean;
};

export type ListLearningSessionsResult = {
  sessions: LearningSessionListItemDto[];
  nextCursor: string | null;
};

const CURSOR_PREFIX = "v1:";

function encodeSessionCursor(row: Pick<LearningSession, "id" | "updatedAt">): string {
  const payload = `${CURSOR_PREFIX}${row.updatedAt.toISOString()}:${row.id}`;
  return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeSessionCursor(rawCursor: string): { updatedAt: Date; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(rawCursor, "base64url").toString("utf8");
  } catch {
    throw new AppError(400, "Invalid cursor", { code: "INVALID_CURSOR" });
  }
  if (!decoded.startsWith(CURSOR_PREFIX)) {
    throw new AppError(400, "Invalid cursor", { code: "INVALID_CURSOR" });
  }
  const rest = decoded.slice(CURSOR_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon <= 0 || lastColon >= rest.length - 1) {
    throw new AppError(400, "Invalid cursor", { code: "INVALID_CURSOR" });
  }
  const iso = rest.slice(0, lastColon);
  const id = rest.slice(lastColon + 1);
  const updatedAt = new Date(iso);
  if (Number.isNaN(updatedAt.getTime()) || !id.trim()) {
    throw new AppError(400, "Invalid cursor", { code: "INVALID_CURSOR" });
  }
  return { updatedAt, id };
}

function toListItemDto(row: {
  id: string;
  topic: string;
  curiosityPrompt: string;
  difficulty: string | null;
  tone: string | null;
  status: string;
  lessonTitle: string | null;
  lessonSummary: string | null;
  lessonBody: string | null;
  sourceGlobalTopicId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LearningSessionListItemDto {
  const lessonReady =
    row.status === "generated" &&
    Boolean(
      row.lessonTitle?.trim() || row.lessonSummary?.trim() || row.lessonBody?.trim(),
    );
  return {
    id: row.id,
    topic: row.topic,
    curiosityPrompt: row.curiosityPrompt,
    difficulty: row.difficulty,
    tone: row.tone,
    status: row.status,
    lessonTitle: row.lessonTitle,
    lessonSummary: row.lessonSummary,
    sourceGlobalTopicId: row.sourceGlobalTopicId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lessonReady,
  };
}

const listSelect = {
  id: true,
  topic: true,
  curiosityPrompt: true,
  difficulty: true,
  tone: true,
  status: true,
  lessonTitle: true,
  lessonSummary: true,
  lessonBody: true,
  sourceGlobalTopicId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Read-only, user-scoped session list for product surfaces (My Brain, etc.).
 * Ordered by `updatedAt` DESC, `id` DESC for stable cursor pagination.
 */
export async function listLearningSessionsForUser(
  userId: string,
  input: { limit: number; cursor?: string | null },
): Promise<ListLearningSessionsResult> {
  const limit = Math.min(Math.max(1, input.limit), 50);
  const take = limit + 1;

  let cursorUpdatedAt: Date | undefined;
  let cursorId: string | undefined;
  if (input.cursor !== undefined && input.cursor !== null && input.cursor.trim() !== "") {
    const c = decodeSessionCursor(input.cursor.trim());
    cursorUpdatedAt = c.updatedAt;
    cursorId = c.id;
  }

  const rows = await prisma.learningSession.findMany({
    where: {
      userId,
      ...(cursorUpdatedAt !== undefined && cursorId !== undefined
        ? {
            OR: [
              { updatedAt: { lt: cursorUpdatedAt } },
              {
                AND: [{ updatedAt: cursorUpdatedAt }, { id: { lt: cursorId } }],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
    select: listSelect,
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last !== undefined ? encodeSessionCursor({ id: last.id, updatedAt: last.updatedAt }) : null;

  return {
    sessions: pageRows.map(toListItemDto),
    nextCursor,
  };
}

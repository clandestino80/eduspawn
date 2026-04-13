import { prisma } from "../../../lib/prisma";

export async function findUserGenerationUsageDailyRow(params: {
  userId: string;
  usageDate: Date;
}): Promise<{
  freshGenerationsUsed: number;
  learningStartsUsed: number;
  gpt4oMiniShortPacksUsed: number;
  gpt54ShortPacksUsed: number;
} | null> {
  const row = await prisma.userGenerationUsageDaily.findUnique({
    where: {
      userId_usageDate: {
        userId: params.userId,
        usageDate: params.usageDate,
      },
    },
    select: {
      freshGenerationsUsed: true,
      learningStartsUsed: true,
      gpt4oMiniShortPacksUsed: true,
      gpt54ShortPacksUsed: true,
    },
  });
  return row;
}

export async function incrementFreshGenerationsUsed(params: {
  userId: string;
  usageDate: Date;
  delta: number;
}): Promise<void> {
  const d = params.delta;
  if (d <= 0) return;
  await prisma.userGenerationUsageDaily.upsert({
    where: {
      userId_usageDate: {
        userId: params.userId,
        usageDate: params.usageDate,
      },
    },
    create: {
      userId: params.userId,
      usageDate: params.usageDate,
      freshGenerationsUsed: d,
      learningStartsUsed: 0,
      gpt4oMiniShortPacksUsed: 0,
      gpt54ShortPacksUsed: 0,
    },
    update: {
      freshGenerationsUsed: { increment: d },
    },
  });
}

export async function incrementLearningStartsUsed(params: {
  userId: string;
  usageDate: Date;
  delta: number;
}): Promise<void> {
  const d = Math.max(1, Math.floor(params.delta));
  await prisma.userGenerationUsageDaily.upsert({
    where: {
      userId_usageDate: {
        userId: params.userId,
        usageDate: params.usageDate,
      },
    },
    create: {
      userId: params.userId,
      usageDate: params.usageDate,
      freshGenerationsUsed: 0,
      learningStartsUsed: d,
      gpt4oMiniShortPacksUsed: 0,
      gpt54ShortPacksUsed: 0,
    },
    update: {
      learningStartsUsed: { increment: d },
    },
  });
}

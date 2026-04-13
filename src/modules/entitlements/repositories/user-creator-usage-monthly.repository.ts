import { prisma } from "../../../lib/prisma";

export async function findUserCreatorUsageMonthlyRow(params: {
  userId: string;
  periodMonth: string;
}): Promise<{ creatorMinutesUsed: number; premiumGenerationsUsed: number } | null> {
  return prisma.userCreatorUsageMonthly.findUnique({
    where: {
      userId_periodMonth: {
        userId: params.userId,
        periodMonth: params.periodMonth,
      },
    },
    select: {
      creatorMinutesUsed: true,
      premiumGenerationsUsed: true,
    },
  });
}

export async function incrementCreatorMinutesUsed(params: {
  userId: string;
  periodMonth: string;
  minutes: number;
}): Promise<void> {
  const m = Math.max(0, Math.ceil(params.minutes));
  if (m === 0) return;
  await prisma.userCreatorUsageMonthly.upsert({
    where: {
      userId_periodMonth: {
        userId: params.userId,
        periodMonth: params.periodMonth,
      },
    },
    create: {
      userId: params.userId,
      periodMonth: params.periodMonth,
      creatorMinutesUsed: m,
      premiumGenerationsUsed: 0,
    },
    update: {
      creatorMinutesUsed: { increment: m },
    },
  });
}

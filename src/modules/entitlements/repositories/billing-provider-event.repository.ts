import { Prisma } from "@prisma/client";
import type { BillingProvider, BillingProviderEventStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export async function findBillingProviderEventByProviderAndEventId(params: {
  provider: BillingProvider;
  providerEventId: string;
}): Promise<{
  id: string;
  processingStatus: BillingProviderEventStatus;
  payloadJson: unknown;
  eventType: string;
} | null> {
  return prisma.billingProviderEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: params.provider,
        providerEventId: params.providerEventId,
      },
    },
    select: {
      id: true,
      processingStatus: true,
      payloadJson: true,
      eventType: true,
    },
  });
}

export async function findBillingProviderEventById(id: string): Promise<{
  id: string;
  provider: BillingProvider;
  providerEventId: string;
  processingStatus: BillingProviderEventStatus;
  payloadJson: unknown;
  eventType: string;
} | null> {
  return prisma.billingProviderEvent.findUnique({
    where: { id },
    select: {
      id: true,
      provider: true,
      providerEventId: true,
      processingStatus: true,
      payloadJson: true,
      eventType: true,
    },
  });
}

export async function createBillingProviderEventReceived(params: {
  provider: BillingProvider;
  providerEventId: string;
  eventType: string;
  normalizedEventType: string;
  userId: string | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  externalProductId: string | null;
  payloadJson: Prisma.InputJsonValue;
}): Promise<{ id: string; created: boolean }> {
  try {
    const row = await prisma.billingProviderEvent.create({
      data: {
        provider: params.provider,
        providerEventId: params.providerEventId,
        eventType: params.eventType,
        normalizedEventType: params.normalizedEventType,
        userId: params.userId,
        externalCustomerId: params.externalCustomerId,
        externalSubscriptionId: params.externalSubscriptionId,
        externalProductId: params.externalProductId,
        payloadJson: params.payloadJson,
        processingStatus: "RECEIVED",
      },
      select: { id: true },
    });
    return { id: row.id, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const ex = await prisma.billingProviderEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: params.provider,
            providerEventId: params.providerEventId,
          },
        },
        select: { id: true },
      });
      if (!ex) throw e;
      return { id: ex.id, created: false };
    }
    throw e;
  }
}

export async function claimBillingProviderEventForProcessing(id: string): Promise<boolean> {
  const res = await prisma.billingProviderEvent.updateMany({
    where: {
      id,
      processingStatus: { in: ["RECEIVED", "FAILED"] },
    },
    data: { processingStatus: "PROCESSING" },
  });
  return res.count === 1;
}

export async function markBillingProviderEventProcessed(id: string): Promise<void> {
  await prisma.billingProviderEvent.update({
    where: { id },
    data: {
      processingStatus: "PROCESSED",
      processedAt: new Date(),
      errorMessage: null,
    },
  });
}

export async function markBillingProviderEventFailed(id: string, errorMessage: string): Promise<void> {
  await prisma.billingProviderEvent.update({
    where: { id },
    data: {
      processingStatus: "FAILED",
      errorMessage: errorMessage.slice(0, 8000),
    },
  });
}

export async function markBillingProviderEventIgnored(id: string): Promise<void> {
  await prisma.billingProviderEvent.update({
    where: { id },
    data: {
      processingStatus: "IGNORED",
      processedAt: new Date(),
      errorMessage: null,
    },
  });
}

export async function resetBillingProviderEventForReprocess(id: string): Promise<boolean> {
  const res = await prisma.billingProviderEvent.updateMany({
    where: { id, processingStatus: "FAILED" },
    data: {
      processingStatus: "RECEIVED",
      errorMessage: null,
    },
  });
  return res.count === 1;
}

export async function listRecentBillingProviderEvents(params: {
  limit: number;
  provider?: BillingProvider;
}): Promise<
  {
    id: string;
    provider: BillingProvider;
    providerEventId: string;
    eventType: string;
    normalizedEventType: string;
    processingStatus: BillingProviderEventStatus;
    userId: string | null;
    createdAt: Date;
    processedAt: Date | null;
  }[]
> {
  return prisma.billingProviderEvent.findMany({
    where: params.provider ? { provider: params.provider } : undefined,
    orderBy: { createdAt: "desc" },
    take: params.limit,
    select: {
      id: true,
      provider: true,
      providerEventId: true,
      eventType: true,
      normalizedEventType: true,
      processingStatus: true,
      userId: true,
      createdAt: true,
      processedAt: true,
    },
  });
}

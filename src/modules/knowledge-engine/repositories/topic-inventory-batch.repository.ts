import type { Prisma } from "@prisma/client";
import type { TopicInventoryBatchStatus, TopicInventoryBatchType } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

export type TopicInventoryBatchCreateParams = {
  batchType: TopicInventoryBatchType;
  requestedCount: number;
  domainHint?: string | null;
  subdomainHint?: string | null;
  status?: TopicInventoryBatchStatus;
  metadataJson?: Prisma.InputJsonValue | null;
};

export async function createTopicInventoryBatchPending(
  params: TopicInventoryBatchCreateParams,
): Promise<string> {
  const row = await prisma.topicInventoryBatch.create({
    data: {
      batchType: params.batchType,
      requestedCount: params.requestedCount,
      acceptedCount: 0,
      rejectedCount: 0,
      domainHint: params.domainHint ?? undefined,
      subdomainHint: params.subdomainHint ?? undefined,
      status: params.status ?? "PENDING",
      metadataJson: params.metadataJson ?? undefined,
    },
    select: { id: true },
  });
  return row.id;
}

export async function updateTopicInventoryBatch(
  id: string,
  data: Prisma.TopicInventoryBatchUpdateInput,
): Promise<void> {
  await prisma.topicInventoryBatch.update({
    where: { id },
    data,
  });
}

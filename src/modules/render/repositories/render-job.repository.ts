import { Prisma } from "@prisma/client";
import type { RenderJobStatus, RenderPackSourceIntent, RenderProviderKind } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { AppError } from "../../../lib/errors";
import { decrementRenderCreditsInTx, incrementRenderCreditsInTx } from "../../entitlements/repositories/user-credit-wallet.repository";

type Tx = Prisma.TransactionClient;

function toNullableJsonInput(value: Prisma.InputJsonValue | null): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null ? Prisma.DbNull : value;
}

export type RenderJobRow = {
  id: string;
  userId: string;
  creatorPackId: string;
  learningSessionId: string | null;
  provider: RenderProviderKind;
  providerJobId: string | null;
  status: RenderJobStatus;
  renderKind: string;
  targetDurationSec: number;
  targetPlatform: string;
  requestedWithEditedPack: boolean;
  sourcePackIntent: RenderPackSourceIntent;
  creditCost: number;
  consumedCreditLedgerEntryId: string | null;
  refundLedgerEntryId: string | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  metadataJson: Prisma.JsonValue | null;
  failureReason: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const publicSelect = {
  id: true,
  userId: true,
  creatorPackId: true,
  learningSessionId: true,
  provider: true,
  providerJobId: true,
  status: true,
  renderKind: true,
  targetDurationSec: true,
  targetPlatform: true,
  requestedWithEditedPack: true,
  sourcePackIntent: true,
  creditCost: true,
  consumedCreditLedgerEntryId: true,
  refundLedgerEntryId: true,
  outputUrl: true,
  thumbnailUrl: true,
  metadataJson: true,
  failureReason: true,
  idempotencyKey: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function findRenderJobByUserIdempotencyKey(args: {
  userId: string;
  idempotencyKey: string;
}): Promise<RenderJobRow | null> {
  return prisma.renderJob.findFirst({
    where: { userId: args.userId, idempotencyKey: args.idempotencyKey },
    select: publicSelect,
  });
}

export async function findRenderJobOwned(args: { jobId: string; userId: string }): Promise<RenderJobRow | null> {
  return prisma.renderJob.findFirst({
    where: { id: args.jobId, userId: args.userId },
    select: publicSelect,
  });
}

export async function findRenderJobByProviderJob(args: {
  provider: RenderProviderKind;
  providerJobId: string;
}): Promise<RenderJobRow | null> {
  return prisma.renderJob.findFirst({
    where: { provider: args.provider, providerJobId: args.providerJobId },
    select: publicSelect,
  });
}

export async function listRenderJobsForUser(args: { userId: string; limit: number }): Promise<RenderJobRow[]> {
  return prisma.renderJob.findMany({
    where: { userId: args.userId },
    orderBy: { createdAt: "desc" },
    take: args.limit,
    select: publicSelect,
  });
}

export async function createRenderJobAndDebitCredits(args: {
  tx: Tx;
  data: {
    userId: string;
    creatorPackId: string;
    learningSessionId: string | null;
    provider: RenderProviderKind;
    renderKind: string;
    targetDurationSec: number;
    targetPlatform: string;
    requestedWithEditedPack: boolean;
    sourcePackIntent: RenderPackSourceIntent;
    creditCost: number;
    idempotencyKey: string | null;
    metadataJson?: Prisma.InputJsonValue | null;
  };
  debit: {
    source: string;
    extraMetadata?: Prisma.InputJsonValue | null;
  };
}): Promise<{ job: RenderJobRow; ledgerEntryId: string }> {
  const { tx, data, debit } = args;
  const createData: Prisma.RenderJobUncheckedCreateInput = {
    userId: data.userId,
    creatorPackId: data.creatorPackId,
    learningSessionId: data.learningSessionId,
    provider: data.provider,
    status: "QUEUED",
    renderKind: data.renderKind,
    targetDurationSec: data.targetDurationSec,
    targetPlatform: data.targetPlatform,
    requestedWithEditedPack: data.requestedWithEditedPack,
    sourcePackIntent: data.sourcePackIntent,
    creditCost: data.creditCost,
    idempotencyKey: data.idempotencyKey,
  };
  if (data.metadataJson !== undefined) {
    createData.metadataJson = toNullableJsonInput(data.metadataJson);
  }
  const job = await tx.renderJob.create({
    data: createData,
    select: publicSelect,
  });

  const dec = await decrementRenderCreditsInTx(tx, {
    userId: data.userId,
    amount: data.creditCost,
    reason: `render_job:${job.id}`,
    source: debit.source,
    metadataJson: {
      renderJobId: job.id,
      creatorPackId: data.creatorPackId,
      creditCost: data.creditCost,
      ...(typeof debit.extraMetadata === "object" && debit.extraMetadata !== null ? debit.extraMetadata : {}),
    },
  });
  if (!dec.ok) {
    throw new AppError(402, "Insufficient render credits", {
      code: "RENDER_CREDITS_EXHAUSTED",
      details: { balance: dec.balance },
    });
  }

  const updated = await tx.renderJob.update({
    where: { id: job.id },
    data: { consumedCreditLedgerEntryId: dec.ledgerEntryId },
    select: publicSelect,
  });

  return { job: updated, ledgerEntryId: dec.ledgerEntryId };
}

export async function markRenderJobSubmitted(args: {
  jobId: string;
  providerJobId: string;
  metadataJson?: Prisma.InputJsonValue | null;
}): Promise<void> {
  const data: Prisma.RenderJobUpdateInput = {
    status: "SUBMITTED",
    providerJobId: args.providerJobId,
  };
  if (args.metadataJson !== undefined) {
    data.metadataJson = toNullableJsonInput(args.metadataJson);
  }
  await prisma.renderJob.update({
    where: { id: args.jobId },
    data,
  });
}

export async function applyRenderJobStatusFromProvider(args: {
  jobId: string;
  nextStatus: RenderJobStatus;
  outputUrl?: string | null;
  thumbnailUrl?: string | null;
  failureReason?: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
}): Promise<number> {
  const data: Prisma.RenderJobUpdateManyMutationInput = {
    status: args.nextStatus,
  };
  if (args.outputUrl !== undefined) data.outputUrl = args.outputUrl;
  if (args.thumbnailUrl !== undefined) data.thumbnailUrl = args.thumbnailUrl;
  if (args.failureReason !== undefined) data.failureReason = args.failureReason;
  if (args.metadataJson !== undefined) data.metadataJson = toNullableJsonInput(args.metadataJson);

  return (
    await prisma.renderJob.updateMany({
      where: {
        id: args.jobId,
        status: { in: ["QUEUED", "SUBMITTED", "PROCESSING"] },
      },
      data,
    })
  ).count;
}

export async function applyRenderJobSucceededFinal(args: {
  jobId: string;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
}): Promise<number> {
  const data: Prisma.RenderJobUpdateManyMutationInput = {
    status: "SUCCEEDED",
    outputUrl: args.outputUrl,
    thumbnailUrl: args.thumbnailUrl,
  };
  if (args.metadataJson !== undefined) {
    data.metadataJson = toNullableJsonInput(args.metadataJson);
  }
  return (
    await prisma.renderJob.updateMany({
      where: {
        id: args.jobId,
        status: { in: ["SUBMITTED", "PROCESSING"] },
      },
      data,
    })
  ).count;
}

export async function finalizeRenderJobFailedWithRefund(args: {
  tx: Tx;
  jobId: string;
  userId: string;
  creditCost: number;
  failureReason: string;
  consumedCreditLedgerEntryId: string | null;
}): Promise<void> {
  const row = await args.tx.renderJob.findUnique({
    where: { id: args.jobId },
    select: { refundLedgerEntryId: true, creditCost: true },
  });
  if (!row || row.refundLedgerEntryId) {
    return;
  }
  const cost = args.creditCost > 0 ? args.creditCost : row.creditCost;
  if (cost <= 0) {
    await args.tx.renderJob.update({
      where: { id: args.jobId },
      data: { status: "FAILED", failureReason: args.failureReason },
    });
    return;
  }

  const refund = await incrementRenderCreditsInTx(args.tx, {
    userId: args.userId,
    amount: cost,
    entryType: "ADJUSTMENT",
    reason: `render_job_refund:${args.jobId}`,
    source: "render_refund",
    metadataJson: {
      renderJobId: args.jobId,
      originalConsumptionLedgerId: args.consumedCreditLedgerEntryId,
    },
  });

  await args.tx.renderJob.update({
    where: { id: args.jobId },
    data: {
      status: "FAILED",
      failureReason: args.failureReason,
      refundLedgerEntryId: refund.ledgerEntryId,
    },
  });
}

const ACTIVE_RENDER_STATUSES = ["QUEUED", "SUBMITTED", "PROCESSING"] as const;

export async function countActiveRenderJobsForUser(userId: string): Promise<number> {
  return prisma.renderJob.count({
    where: { userId, status: { in: [...ACTIVE_RENDER_STATUSES] } },
  });
}

export async function countActiveRenderJobsForUserAndPack(args: {
  userId: string;
  creatorPackId: string;
}): Promise<number> {
  return prisma.renderJob.count({
    where: {
      userId: args.userId,
      creatorPackId: args.creatorPackId,
      status: { in: [...ACTIVE_RENDER_STATUSES] },
    },
  });
}

export type OpsRenderJobSummaryRow = {
  id: string;
  userId: string;
  status: RenderJobStatus;
  provider: RenderProviderKind;
  creatorPackId: string;
  creditCost: number;
  failureReason: string | null;
  hasOutput: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function listRecentRenderJobsForOps(args: { limit: number }): Promise<OpsRenderJobSummaryRow[]> {
  const rows = await prisma.renderJob.findMany({
    orderBy: { createdAt: "desc" },
    take: args.limit,
    select: {
      id: true,
      userId: true,
      status: true,
      provider: true,
      creatorPackId: true,
      creditCost: true,
      failureReason: true,
      outputUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    status: r.status,
    provider: r.provider,
    creatorPackId: r.creatorPackId,
    creditCost: r.creditCost,
    failureReason: r.failureReason,
    hasOutput: Boolean(r.outputUrl && String(r.outputUrl).trim().length > 0),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

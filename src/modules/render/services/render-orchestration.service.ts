import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { CreatorPackKind, RenderProviderKind } from "@prisma/client";
import { getEnv } from "../../../config/env";
import { AppError } from "../../../lib/errors";
import { prisma } from "../../../lib/prisma";
import { findUserCreatorPackForRender } from "../../creator/repositories/user-creator-pack.repository";
import { getOrCreateUserCreditWallet } from "../../entitlements/services/credit-wallet.service";
import { getRenderProviderAdapter } from "../adapters/render-provider-registry";
import type { InternalRenderNarrativePayload, SubmitRenderInput } from "../render-provider.types";
import {
  applyRenderJobStatusFromProvider,
  applyRenderJobSucceededFinal,
  createRenderJobAndDebitCredits,
  finalizeRenderJobFailedWithRefund,
  findRenderJobByProviderJob,
  findRenderJobByUserIdempotencyKey,
  findRenderJobOwned,
  listRenderJobsForUser,
  markRenderJobSubmitted,
  type RenderJobRow,
} from "../repositories/render-job.repository";
import type { CreateRenderJobBody } from "../schemas/render-request.schema";
import type { WebhookHeaderBag } from "../render-provider.types";
import { parseNormalizedRenderWebhook } from "./render-webhook-parser";
import { assertWebhookClockSkew } from "./render-webhook-verification";
import { computeCreatorPackRenderCreditCost } from "./render-credit-policy";
import { assertRenderSubmissionAbuseControls } from "../../security/abuse-controls.service";
import { logProductEvent } from "../../../lib/product-log";

const RENDER_KIND_VIDEO_CREATOR_PACK = "video_creator_pack_v1";

function cloneJson<T>(v: unknown): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function readDurationFromPackRequest(requestJson: unknown, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  if (requestJson && typeof requestJson === "object" && "durationSec" in requestJson) {
    const n = Number((requestJson as { durationSec?: unknown }).durationSec);
    if (Number.isFinite(n) && n >= 5) return Math.floor(n);
  }
  return 60;
}

function readTargetPlatform(requestJson: unknown, override?: string): string {
  const o = override?.trim();
  if (o) return o.slice(0, 64);
  if (requestJson && typeof requestJson === "object" && "targetPlatform" in requestJson) {
    const p = String((requestJson as { targetPlatform?: unknown }).targetPlatform ?? "").trim();
    if (p) return p.slice(0, 64);
  }
  return "generic";
}

function buildNarrativePayload(args: {
  packKind: CreatorPackKind;
  systemOriginalJson: unknown;
  userEditedJson: unknown | null;
  useEditedPack: boolean;
  targetDurationSec: number;
  targetPlatform: string;
  renderPreset?: string;
}): InternalRenderNarrativePayload {
  const sourceIntent: InternalRenderNarrativePayload["sourceIntent"] = args.useEditedPack
    ? "USER_EDITED_PRIVATE"
    : "SYSTEM_ORIGINAL";
  const base = args.useEditedPack && args.userEditedJson != null ? args.userEditedJson : args.systemOriginalJson;
  const script = cloneJson<Record<string, unknown>>(base);
  return {
    packKind: args.packKind,
    script,
    targetDurationSec: args.targetDurationSec,
    targetPlatform: args.targetPlatform,
    renderPreset: args.renderPreset,
    sourceIntent,
  };
}

export type PublicRenderJobDto = {
  jobId: string;
  status: RenderJobRow["status"];
  provider: RenderProviderKind;
  providerJobId: string | null;
  creatorPackId: string;
  learningSessionId: string | null;
  renderKind: string;
  targetDurationSec: number;
  targetPlatform: string;
  requestedWithEditedPack: boolean;
  sourcePackIntent: RenderJobRow["sourcePackIntent"];
  creditCost: number;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  failureReason: string | null;
  refunded: boolean;
  createdAt: string;
  updatedAt: string;
};

function toPublicRenderJobDto(row: RenderJobRow): PublicRenderJobDto {
  return {
    jobId: row.id,
    status: row.status,
    provider: row.provider,
    providerJobId: row.providerJobId,
    creatorPackId: row.creatorPackId,
    learningSessionId: row.learningSessionId,
    renderKind: row.renderKind,
    targetDurationSec: row.targetDurationSec,
    targetPlatform: row.targetPlatform,
    requestedWithEditedPack: row.requestedWithEditedPack,
    sourcePackIntent: row.sourcePackIntent,
    creditCost: row.creditCost,
    outputUrl: row.outputUrl,
    thumbnailUrl: row.thumbnailUrl,
    failureReason: row.failureReason,
    refunded: Boolean(row.refundLedgerEntryId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveProvider(body: CreateRenderJobBody): RenderProviderKind {
  if (body.providerOverride) return body.providerOverride;
  return getEnv().RENDER_DEFAULT_PROVIDER;
}

function mergeMetadata(
  existing: Prisma.JsonValue | null,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as object) } : {};
  return { ...base, ...patch };
}

export async function startRenderJobForUser(
  userId: string,
  body: CreateRenderJobBody,
): Promise<PublicRenderJobDto> {
  await getOrCreateUserCreditWallet(userId);

  if (body.idempotencyKey) {
    const existing = await findRenderJobByUserIdempotencyKey({
      userId,
      idempotencyKey: body.idempotencyKey,
    });
    if (existing) {
      logProductEvent("render_job_idempotent_hit", {
        userId,
        renderJobId: existing.id,
        idempotencyKey: body.idempotencyKey,
      });
      return toPublicRenderJobDto(existing);
    }
  }

  await assertRenderSubmissionAbuseControls({ userId, creatorPackId: body.creatorPackId });

  const pack = await findUserCreatorPackForRender({ userId, packId: body.creatorPackId });
  if (!pack) {
    throw new AppError(404, "Creator pack not found", { code: "NOT_FOUND" });
  }

  if (body.useEditedPack && (pack.userEditedJson === null || pack.userEditedJson === undefined)) {
    throw new AppError(400, "No edited pack saved for this creator pack yet.", {
      code: "RENDER_EDITED_PACK_MISSING",
    });
  }

  const creditCost = computeCreatorPackRenderCreditCost(pack.packKind);
  const targetDurationSec = readDurationFromPackRequest(pack.requestJson, body.targetDurationSec);
  const targetPlatform = readTargetPlatform(pack.requestJson, body.targetPlatform);
  const provider = resolveProvider(body);
  const sourcePackIntent = body.useEditedPack ? "USER_EDITED_PRIVATE" : "SYSTEM_ORIGINAL";

  const narrative = buildNarrativePayload({
    packKind: pack.packKind,
    systemOriginalJson: pack.systemOriginalJson,
    userEditedJson: pack.userEditedJson,
    useEditedPack: body.useEditedPack,
    targetDurationSec,
    targetPlatform,
    renderPreset: body.renderPreset,
  });

  let jobRow: RenderJobRow;
  try {
    const created = await prisma.$transaction(async (tx) => {
      return createRenderJobAndDebitCredits({
        tx,
        data: {
          userId,
          creatorPackId: pack.id,
          learningSessionId: pack.learningSessionId,
          provider,
          renderKind: RENDER_KIND_VIDEO_CREATOR_PACK,
          targetDurationSec,
          targetPlatform,
          requestedWithEditedPack: body.useEditedPack,
          sourcePackIntent,
          creditCost,
          idempotencyKey: body.idempotencyKey ?? null,
          metadataJson: {
            provenance: "creator_pack_render",
            packKind: pack.packKind,
          },
        },
        debit: {
          source: "render_pipeline",
          extraMetadata: { creatorPackId: pack.id },
        },
      });
    });
    jobRow = created.job;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && body.idempotencyKey) {
      const existing = await findRenderJobByUserIdempotencyKey({
        userId,
        idempotencyKey: body.idempotencyKey,
      });
      if (existing) return toPublicRenderJobDto(existing);
    }
    throw e;
  }

  const adapter = getRenderProviderAdapter(provider);
  const submitInput: SubmitRenderInput = {
    renderJobId: jobRow.id,
    userId,
    creatorPackId: pack.id,
    narrative,
  };

  const submit = await adapter.submitRender(submitInput);
  if (!submit.ok) {
    logProductEvent("render_provider_submit_failed", {
      userId,
      renderJobId: jobRow.id,
      creatorPackId: pack.id,
      provider,
      message: submit.message,
    });
    await prisma.$transaction(async (tx) => {
      await finalizeRenderJobFailedWithRefund({
        tx,
        jobId: jobRow.id,
        userId,
        creditCost,
        failureReason: submit.message,
        consumedCreditLedgerEntryId: jobRow.consumedCreditLedgerEntryId,
      });
    });
    const failed = await findRenderJobOwned({ jobId: jobRow.id, userId });
    logProductEvent("render_job_failed_refund", {
      userId,
      renderJobId: jobRow.id,
      refunded: Boolean(failed?.refundLedgerEntryId),
    });
    return toPublicRenderJobDto(failed!);
  }

  const mergedMeta = mergeMetadata(jobRow.metadataJson, {
    providerSubmit: submit.metadataJson ?? { accepted: true },
  });
  await markRenderJobSubmitted({
    jobId: jobRow.id,
    providerJobId: submit.providerJobId,
    metadataJson: mergedMeta,
  });

  const done = await findRenderJobOwned({ jobId: jobRow.id, userId });
  logProductEvent("render_job_submitted", {
    userId,
    renderJobId: done!.id,
    creatorPackId: pack.id,
    provider,
    status: done!.status,
    creditCost,
  });
  return toPublicRenderJobDto(done!);
}

export async function getRenderJobForUser(userId: string, jobId: string): Promise<PublicRenderJobDto> {
  const row = await findRenderJobOwned({ jobId, userId });
  if (!row) {
    throw new AppError(404, "Render job not found", { code: "NOT_FOUND" });
  }
  return toPublicRenderJobDto(row);
}

export async function listRenderJobsForUserPublic(userId: string, limit: number): Promise<PublicRenderJobDto[]> {
  const rows = await listRenderJobsForUser({ userId, limit });
  return rows.map(toPublicRenderJobDto);
}

export async function refreshRenderJobStatusForUser(userId: string, jobId: string): Promise<PublicRenderJobDto> {
  const row = await findRenderJobOwned({ jobId, userId });
  if (!row) {
    throw new AppError(404, "Render job not found", { code: "NOT_FOUND" });
  }
  if (!row.providerJobId) {
    return toPublicRenderJobDto(row);
  }
  if (row.status === "SUCCEEDED" || row.status === "FAILED" || row.status === "CANCELED") {
    return toPublicRenderJobDto(row);
  }

  const adapter = getRenderProviderAdapter(row.provider);
  const st = await adapter.getRenderStatus({ providerJobId: row.providerJobId });
  if (!st.ok) {
    return toPublicRenderJobDto(row);
  }

  if (st.status === "PROCESSING") {
    await applyRenderJobStatusFromProvider({
      jobId: row.id,
      nextStatus: "PROCESSING",
      metadataJson: st.metadataJson ?? undefined,
    });
  } else if (st.status === "SUCCEEDED") {
    const n = await applyRenderJobSucceededFinal({
      jobId: row.id,
      outputUrl: st.outputUrl ?? null,
      thumbnailUrl: st.thumbnailUrl ?? null,
      metadataJson: st.metadataJson ?? undefined,
    });
    if (n === 0 && st.outputUrl) {
      await prisma.renderJob.updateMany({
        where: { id: row.id, status: "SUCCEEDED" },
        data: {
          outputUrl: st.outputUrl,
          thumbnailUrl: st.thumbnailUrl ?? undefined,
        },
      });
    }
  } else if (st.status === "FAILED") {
    await prisma.$transaction(async (tx) => {
      await finalizeRenderJobFailedWithRefund({
        tx,
        jobId: row.id,
        userId,
        creditCost: row.creditCost,
        failureReason: st.failureReason ?? "Provider reported failure",
        consumedCreditLedgerEntryId: row.consumedCreditLedgerEntryId,
      });
    });
  }

  const next = await findRenderJobOwned({ jobId, userId });
  return toPublicRenderJobDto(next!);
}

function webhookSecretOk(header: string | undefined, expected: string): boolean {
  const provided = header?.trim() ?? "";
  if (!expected || provided.length === 0) return false;
  try {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function processRenderProviderWebhook(
  secretHeader: string | undefined,
  rawBody: unknown,
  headers: WebhookHeaderBag,
): Promise<{ updated: boolean; jobId: string }> {
  const env = getEnv();
  const expected = env.RENDER_WEBHOOK_SECRET?.trim();
  if (!expected) {
    logProductEvent("render_webhook_rejected", { reason: "disabled" });
    throw new AppError(503, "Render webhooks are not configured", { code: "RENDER_WEBHOOK_DISABLED" });
  }
  if (!webhookSecretOk(secretHeader, expected)) {
    logProductEvent("render_webhook_rejected", { reason: "bad_secret" });
    throw new AppError(401, "Invalid render webhook secret", { code: "RENDER_WEBHOOK_UNAUTHORIZED" });
  }

  assertWebhookClockSkew(headers);
  const body = parseNormalizedRenderWebhook(rawBody, headers);

  const job = await findRenderJobByProviderJob({
    provider: body.provider,
    providerJobId: body.providerJobId,
  });
  if (!job) {
    logProductEvent("render_webhook_unknown_job", {
      provider: body.provider,
      providerJobId: body.providerJobId,
    });
    throw new AppError(404, "Render job not found for provider reference", { code: "NOT_FOUND" });
  }

  if (job.status === "FAILED" || job.status === "CANCELED") {
    logProductEvent("render_webhook_noop_terminal", { renderJobId: job.id, status: job.status });
    return { updated: false, jobId: job.id };
  }
  if (job.status === "SUCCEEDED" && body.status !== "SUCCEEDED") {
    logProductEvent("render_webhook_noop_post_success", { renderJobId: job.id, bodyStatus: body.status });
    return { updated: false, jobId: job.id };
  }
  if (job.status === "SUCCEEDED" && body.status === "SUCCEEDED") {
    logProductEvent("render_webhook_duplicate_success", { renderJobId: job.id });
    return { updated: false, jobId: job.id };
  }

  if (body.status === "PROCESSING") {
    const n = await applyRenderJobStatusFromProvider({
      jobId: job.id,
      nextStatus: "PROCESSING",
    });
    if (n > 0) {
      logProductEvent("render_webhook_processing", { renderJobId: job.id });
    }
    return { updated: n > 0, jobId: job.id };
  }

  if (body.status === "SUCCEEDED") {
    const n = await applyRenderJobSucceededFinal({
      jobId: job.id,
      outputUrl: body.outputUrl ?? null,
      thumbnailUrl: body.thumbnailUrl ?? null,
      metadataJson: mergeMetadata(job.metadataJson, { webhook: true }),
    });
    if (n > 0) {
      logProductEvent("render_webhook_succeeded", {
        renderJobId: job.id,
        hasOutput: Boolean(body.outputUrl),
      });
    }
    return { updated: n > 0, jobId: job.id };
  }

  await prisma.$transaction(async (tx) => {
    await finalizeRenderJobFailedWithRefund({
      tx,
      jobId: job.id,
      userId: job.userId,
      creditCost: job.creditCost,
      failureReason: body.failureReason ?? "Provider webhook reported failure",
      consumedCreditLedgerEntryId: job.consumedCreditLedgerEntryId,
    });
  });
  logProductEvent("render_webhook_failed_refund", { renderJobId: job.id, userId: job.userId });
  return { updated: true, jobId: job.id };
}

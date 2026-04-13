import type { Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../lib/errors";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import {
  billingOpsRenderJobsQuerySchema,
  billingOpsUserIdParamsSchema,
  billingProviderEventIdParamsSchema,
  billingProviderEventsQuerySchema,
  grantRenderCreditsBodySchema,
  setBillingEntitlementBodySchema,
} from "./billing-ops.schema";
import { findUserBillingEntitlement } from "./repositories/user-billing-entitlement.repository";
import { findUserCreditWalletRow } from "./repositories/user-credit-wallet.repository";
import { listRecentBillingProviderEvents } from "./repositories/billing-provider-event.repository";
import { adminGrantRenderCredits, adminSetUserBillingEntitlement } from "./services/billing-admin.service";
import { reprocessFailedBillingProviderEventForOps } from "./services/billing-provider-event.service";
import { getUserPlanTier } from "./services/entitlement.service";
import { listRecentRenderJobsForOps } from "../render/repositories/render-job.repository";

function mapValidationError(error: ZodError): AppError {
  return new AppError(400, "Request validation failed", {
    code: "VALIDATION_ERROR",
    details: error.flatten().fieldErrors,
  });
}

function parseOrThrow<T>(parseFn: () => T): T {
  try {
    return parseFn();
  } catch (error) {
    if (error instanceof ZodError) {
      throw mapValidationError(error);
    }
    throw error;
  }
}

/** POST .../users/:userId/billing/entitlement */
export async function postBillingSetEntitlementController(req: Request, res: Response): Promise<void> {
  const { userId } = parseOrThrow(() => billingOpsUserIdParamsSchema.parse(req.params));
  const body = parseOrThrow(() => setBillingEntitlementBodySchema.parse(req.body));
  await adminSetUserBillingEntitlement({
    userId,
    planTier: body.planTier,
    subscriptionStatus: body.subscriptionStatus,
    currentPeriodStart: body.currentPeriodStart ? new Date(body.currentPeriodStart) : null,
    currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null,
    entitlementSource: body.entitlementSource ?? "MANUAL",
  });
  res.status(200).json({
    success: true,
    data: { userId, planTier: body.planTier, subscriptionStatus: body.subscriptionStatus },
  });
}

/** POST .../users/:userId/billing/render-credits/grant */
export async function postBillingGrantRenderCreditsController(req: Request, res: Response): Promise<void> {
  const { userId } = parseOrThrow(() => billingOpsUserIdParamsSchema.parse(req.params));
  const body = parseOrThrow(() => grantRenderCreditsBodySchema.parse(req.body));
  await adminGrantRenderCredits({
    userId,
    amount: body.amount,
    reason: body.reason ?? null,
  });
  res.status(200).json({
    success: true,
    data: { userId, amount: body.amount },
  });
}

/** GET .../users/:userId/billing/snapshot — caller subject for audit only */
export async function getBillingSnapshotController(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const operatorSub = authReq.user?.sub ?? "";
  const { userId } = parseOrThrow(() => billingOpsUserIdParamsSchema.parse(req.params));
  const [planTier, row, wallet] = await Promise.all([
    getUserPlanTier(userId),
    findUserBillingEntitlement(userId),
    findUserCreditWalletRow(userId),
  ]);
  const renderCreditsBalance = wallet?.renderCreditsBalance ?? null;

  res.status(200).json({
    success: true,
    data: {
      userId,
      effectivePlanTier: planTier,
      persistedEntitlement: row,
      renderCreditsBalance,
      queriedByOperatorSub: operatorSub,
    },
  });
}

/** GET .../provider-events */
export async function getBillingProviderEventsController(req: Request, res: Response): Promise<void> {
  const query = parseOrThrow(() => billingProviderEventsQuerySchema.parse(req.query));
  const rows = await listRecentBillingProviderEvents({
    limit: query.limit,
    ...(query.provider ? { provider: query.provider } : {}),
  });
  res.status(200).json({ success: true, data: { events: rows } });
}

/** GET .../render-jobs/recent — cross-user summary for ops (no output URLs). */
export async function getBillingOpsRecentRenderJobsController(req: Request, res: Response): Promise<void> {
  const query = parseOrThrow(() => billingOpsRenderJobsQuerySchema.parse(req.query));
  const rows = await listRecentRenderJobsForOps({ limit: query.limit });
  const data = rows.map((r) => ({
    jobId: r.id,
    userId: r.userId,
    status: r.status,
    provider: r.provider,
    creatorPackId: r.creatorPackId,
    creditCost: r.creditCost,
    failureReason: r.failureReason,
    hasOutput: r.hasOutput,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
  res.status(200).json({ success: true, data: { jobs: data } });
}

/** POST .../provider-events/:id/reprocess */
export async function postBillingProviderEventReprocessController(req: Request, res: Response): Promise<void> {
  const { id } = parseOrThrow(() => billingProviderEventIdParamsSchema.parse(req.params));
  const result = await reprocessFailedBillingProviderEventForOps(id);
  res.status(200).json({ success: true, data: result });
}

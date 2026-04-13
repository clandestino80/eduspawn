import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireBillingOps } from "../../middleware/billing-ops.middleware";
import {
  getBillingOpsRecentRenderJobsController,
  getBillingProviderEventsController,
  getBillingSnapshotController,
  postBillingGrantRenderCreditsController,
  postBillingProviderEventReprocessController,
  postBillingSetEntitlementController,
} from "./billing-ops.controller";

/**
 * Internal billing/entitlement ops (no payment webhooks here). Requires auth + billing ops allow-list.
 */
export const billingOpsRouter = Router();

billingOpsRouter.use(requireAuth);
billingOpsRouter.use(requireBillingOps);

billingOpsRouter.post(
  "/users/:userId/billing/entitlement",
  asyncHandler(postBillingSetEntitlementController),
);
billingOpsRouter.post(
  "/users/:userId/billing/render-credits/grant",
  asyncHandler(postBillingGrantRenderCreditsController),
);
billingOpsRouter.get("/users/:userId/billing/snapshot", asyncHandler(getBillingSnapshotController));
billingOpsRouter.get("/provider-events", asyncHandler(getBillingProviderEventsController));
billingOpsRouter.get("/render-jobs/recent", asyncHandler(getBillingOpsRecentRenderJobsController));
billingOpsRouter.post(
  "/provider-events/:id/reprocess",
  asyncHandler(postBillingProviderEventReprocessController),
);

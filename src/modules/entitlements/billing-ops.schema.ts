import {
  BillingProvider,
  BillingSubscriptionStatus,
  EntitlementSource,
} from "@prisma/client";
import { z } from "zod";

export const billingOpsUserIdParamsSchema = z.object({
  userId: z.string().min(1, "userId required"),
});

export const setBillingEntitlementBodySchema = z.object({
  planTier: z.enum(["free", "pro", "premium"]),
  subscriptionStatus: z.nativeEnum(BillingSubscriptionStatus),
  currentPeriodStart: z.union([z.string().datetime(), z.null()]).optional(),
  currentPeriodEnd: z.union([z.string().datetime(), z.null()]).optional(),
  entitlementSource: z.nativeEnum(EntitlementSource).optional(),
});

export type SetBillingEntitlementBody = z.infer<typeof setBillingEntitlementBodySchema>;

export const grantRenderCreditsBodySchema = z.object({
  amount: z.coerce.number().int().positive().max(1_000_000),
  reason: z.string().max(256).optional().nullable(),
});

export type GrantRenderCreditsBody = z.infer<typeof grantRenderCreditsBodySchema>;

export const billingProviderEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  provider: z.nativeEnum(BillingProvider).optional(),
});

export const billingProviderEventIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const billingOpsRenderJobsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(30),
});

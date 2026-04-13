import { z } from "zod";

export const subscriptionCheckoutBodySchema = z.object({
  planTier: z.enum(["pro", "premium"]),
});

export type SubscriptionCheckoutBody = z.infer<typeof subscriptionCheckoutBodySchema>;

export const creditsCheckoutBodySchema = z.object({
  creditPack: z.enum(["small", "medium", "large"]),
});

export type CreditsCheckoutBody = z.infer<typeof creditsCheckoutBodySchema>;

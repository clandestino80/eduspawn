export type CheckoutPlanTier = "pro" | "premium";
export type CreditPack = "small" | "medium" | "large";

/** Render credits granted per pack (must match `render_credits` metadata for webhooks). */
export const RENDER_CREDITS_BY_PACK: Record<CreditPack, number> = {
  small: 25,
  medium: 100,
  large: 500,
};

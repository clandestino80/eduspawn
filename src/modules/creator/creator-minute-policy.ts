import { getEnv } from "../../config/env";

/**
 * Billable creator minutes for one creator generate action.
 * `isReuseFromGlobal`: apply `CREATOR_REUSE_MINUTE_DISCOUNT_PERCENT` (default 50 → pay half, rounded up).
 * Minimum debit is always **1** minute when this function returns a positive base.
 */
export function computeCreatorMinuteDebit(args: { baseMinutes: number; isReuseFromGlobal: boolean }): number {
  const base = Math.max(1, Math.ceil(args.baseMinutes));
  if (!args.isReuseFromGlobal) {
    return base;
  }
  const pct = Math.min(95, Math.max(0, getEnv().CREATOR_REUSE_MINUTE_DISCOUNT_PERCENT));
  const payableFraction = (100 - pct) / 100;
  return Math.max(1, Math.ceil(base * payableFraction));
}

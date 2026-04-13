import type { CreatorPackKind } from "@prisma/client";
import { getEnv } from "../../../config/env";

/**
 * Billable render credits for a creator-pack-backed video job (policy knob; minimum 1).
 */
export function computeCreatorPackRenderCreditCost(packKind: CreatorPackKind): number {
  const env = getEnv();
  if (packKind === "LONG_FORM") {
    return Math.max(1, env.RENDER_CREATOR_PACK_LONG_CREDIT_COST);
  }
  return Math.max(1, env.RENDER_CREATOR_PACK_SHORT_CREDIT_COST);
}

import type { CreatorPackKind } from "@prisma/client";
import { AppError } from "../../lib/errors";
import { getEnv } from "../../config/env";
import type { PlanTier } from "../ai/providers/ai-provider.types";
import type { CreatorGenerationGoal, CreatorGenerationRequest } from "./schemas/creator-request.schema";

const SHORT_PACK_MAX_DURATION_SEC = 300;
const LONG_PACK_MIN_DURATION_SEC = 30;
const LONG_PACK_MAX_DURATION_SEC = 7200;

export function resolvePackKindFromGoal(
  goal: CreatorGenerationGoal,
  planTier: PlanTier,
): CreatorPackKind {
  if (goal === "long_form_creator_pack") {
    if (planTier !== "pro" && planTier !== "premium") {
      throw new AppError(403, "Long-form creator packs require Pro or Premium.", {
        code: "CREATOR_PLAN_BLOCKED",
        details: { requiredTier: "pro", goal },
      });
    }
    return "LONG_FORM";
  }
  return "SHORT_FORM";
}

/**
 * Enforces duration bands: short packs stay short; long packs stay within pro long-form bounds.
 */
export function assertCreatorDurationForPack(args: {
  packKind: CreatorPackKind;
  durationSec: number;
  planTier: PlanTier;
}): void {
  const { packKind, durationSec, planTier } = args;
  if (packKind === "SHORT_FORM") {
    if (durationSec > SHORT_PACK_MAX_DURATION_SEC) {
      throw new AppError(400, `Short creator packs cannot exceed ${SHORT_PACK_MAX_DURATION_SEC} seconds.`, {
        code: "CREATOR_DURATION_NOT_ALLOWED",
        details: { durationSec, max: SHORT_PACK_MAX_DURATION_SEC },
      });
    }
    if (planTier === "free") {
      const maxFree = getEnv().FREE_CREATOR_MAX_DURATION_SEC;
      if (durationSec > maxFree) {
        throw new AppError(400, `Free tier creator packs are limited to ${maxFree} seconds.`, {
          code: "CREATOR_DURATION_NOT_ALLOWED",
          details: { durationSec, max: maxFree, planTier },
        });
      }
    }
    return;
  }

  if (durationSec < LONG_PACK_MIN_DURATION_SEC || durationSec > LONG_PACK_MAX_DURATION_SEC) {
    throw new AppError(400, "Long-form creator duration must be between 30 and 7200 seconds.", {
      code: "CREATOR_DURATION_NOT_ALLOWED",
      details: { durationSec, min: LONG_PACK_MIN_DURATION_SEC, max: LONG_PACK_MAX_DURATION_SEC },
    });
  }
}

/**
 * Stable duration band for reuse keys and edit bounds (not raw seconds alone).
 */
export function computeDurationBand(durationSec: number, packKind: CreatorPackKind): string {
  if (packKind === "LONG_FORM") {
    if (durationSec <= 120) return "long_lte_120";
    if (durationSec <= 300) return "long_lte_300";
    if (durationSec <= 600) return "long_lte_600";
    if (durationSec <= 1200) return "long_lte_1200";
    return "long_gt_1200";
  }
  if (durationSec <= 15) return "short_lte_15";
  if (durationSec <= 30) return "short_lte_30";
  if (durationSec <= 60) return "short_lte_60";
  if (durationSec <= 90) return "short_lte_90";
  return "short_gt_90";
}

/** Billable creator minutes from target duration (short or long pack; cap 30 min per request). */
export function estimateBillableCreatorMinutes(durationSec: number): number {
  return Math.min(30, Math.max(1, Math.ceil(durationSec / 60)));
}

/** @deprecated Use `estimateBillableCreatorMinutes` (same formula). */
export function estimateCreatorMinutesForLongPack(durationSec: number): number {
  return estimateBillableCreatorMinutes(durationSec);
}

export function describePlanPath(args: {
  planTier: PlanTier;
  packKind: CreatorPackKind;
}): "free_short" | "pro_short" | "premium_short" | "pro_long" | "premium_long" {
  const { planTier, packKind } = args;
  if (packKind === "LONG_FORM") {
    return planTier === "premium" ? "premium_long" : "pro_long";
  }
  if (planTier === "premium") return "premium_short";
  if (planTier === "pro") return "pro_short";
  return "free_short";
}

export function requestSummaryForAudit(req: CreatorGenerationRequest): Omit<
  CreatorGenerationRequest,
  "learningSessionId"
> {
  const { learningSessionId: _ls, ...rest } = req;
  return rest;
}

import type { CreatorPackKind, Prisma } from "@prisma/client";
import { getEnv } from "../../../config/env";
import { AppError } from "../../../lib/errors";
import { prisma } from "../../../lib/prisma";
import type { PlanTier } from "../../ai/providers/ai-provider.types";
import {
  canConsumeCreatorMinutes,
  consumeCreatorMinutes,
} from "../../entitlements/services/creator-quota.service";
import {
  canConsumeLearningStart,
  consumeLearningStart,
} from "../../entitlements/services/generation-meter.service";
import { getUserPlanTier } from "../../entitlements/services/entitlement.service";
import { buildCreatorLookupKey, buildCreatorMemoryKeyFacets } from "../creator-memory-key";
import { isEligibleForDefaultGlobalPromotion } from "../creator-promotion-policy";
import { computeCreatorMinuteDebit } from "../creator-minute-policy";
import {
  assertCreatorDurationForPack,
  computeDurationBand,
  describePlanPath,
  estimateBillableCreatorMinutes,
  requestSummaryForAudit,
  resolvePackKindFromGoal,
} from "../creator-plan";
import { longCreatorPackSchema, type LongCreatorPack } from "../schemas/creator-output-long.schema";
import { shortCreatorPackSchema, type ShortCreatorPack } from "../schemas/creator-output-short.schema";
import type { CreatorGenerationRequest } from "../schemas/creator-request.schema";
import { createGlobalCreatorMemoryRow, findActiveGlobalCreatorMemoryByLookupKey } from "../repositories/global-creator-memory.repository";
import {
  createUserCreatorPackRow,
  findUserCreatorPackOwned,
  setUserCreatorPackLinkedGlobalMemory,
  updateUserCreatorPackEditedJson,
} from "../repositories/user-creator-pack.repository";
import { generateCreatorPackWithAi, type CreatorAiMeta } from "./creator-ai.service";
import { assertCreatorGenerationBurstLimit } from "../../security/abuse-controls.service";
import { logProductEvent } from "../../../lib/product-log";

const CREATOR_SCHEMA_VERSION = 1;

export type CreatorGenerateResponseDto = {
  packId: string;
  packKind: CreatorPackKind;
  durationBand: string;
  source: "reused_global" | "fresh_generation";
  planPath: ReturnType<typeof describePlanPath>;
  globalMemoryId?: string;
  reusedFromGlobalMemoryId?: string;
  systemOriginal: ShortCreatorPack | LongCreatorPack;
  aiMeta: CreatorAiMeta | null;
  usedFallback: boolean;
  /** Pro/Premium: creator minutes debited for this action (reuse is discounted). Omitted on free tier. */
  creatorMinutesDebited?: number;
};

function cloneJson<T>(value: Prisma.JsonValue): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parsePackFromGlobalJson(
  packKind: CreatorPackKind,
  json: Prisma.JsonValue,
): ShortCreatorPack | LongCreatorPack | null {
  const raw = cloneJson<unknown>(json);
  if (packKind === "SHORT_FORM") {
    const p = shortCreatorPackSchema.safeParse(raw);
    return p.success ? p.data : null;
  }
  const p = longCreatorPackSchema.safeParse(raw);
  return p.success ? p.data : null;
}

async function assertFreeLearningStartAvailable(userId: string): Promise<void> {
  const ls = await canConsumeLearningStart(userId, 1);
  if (!ls.ok) {
    throw new AppError(429, "Daily learning start limit reached. Try again tomorrow or upgrade your plan.", {
      code: "LEARNING_STARTS_EXHAUSTED",
      details: {
        used: ls.snapshot.used,
        limit: ls.snapshot.limit,
        planTier: ls.snapshot.planTier,
        usageDate: ls.snapshot.usageDate,
      },
    });
  }
}

async function assertProCreatorMinutesAvailable(userId: string, debitMinutes: number): Promise<void> {
  const cm = await canConsumeCreatorMinutes(userId, debitMinutes);
  if (!cm.ok) {
    throw new AppError(429, "Monthly creator minutes limit reached for your plan.", {
      code: "CREATOR_MINUTES_EXHAUSTED",
      details: {
        usedMinutes: cm.snapshot.usedMinutes,
        limitMinutes: cm.snapshot.limitMinutes,
        planTier: cm.snapshot.planTier,
        planStillActive: true,
        creatorGenerationExhausted: true,
      },
    });
  }
}

async function assertLearningSessionOwned(userId: string, sessionId: string): Promise<void> {
  const row = await prisma.learningSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  if (!row) {
    throw new AppError(404, "Learning session not found", { code: "NOT_FOUND" });
  }
}

async function tryPromoteGlobalMemory(args: {
  userId: string;
  packId: string;
  lookupKey: string;
  facets: ReturnType<typeof buildCreatorMemoryKeyFacets>;
  packKind: CreatorPackKind;
  originalPack: ShortCreatorPack | LongCreatorPack;
  provenanceJson: Prisma.InputJsonValue;
}): Promise<string | undefined> {
  const env = getEnv();
  if (!env.CREATOR_GLOBAL_MEMORY_AUTO_PROMOTE) {
    return undefined;
  }
  if (!isEligibleForDefaultGlobalPromotion({ originalPack: args.originalPack })) {
    return undefined;
  }

  try {
    const created = await createGlobalCreatorMemoryRow({
      lookupKey: args.lookupKey,
      keyFacetsJson: args.facets as unknown as Prisma.InputJsonValue,
      packKind: args.packKind,
      originalPackJson: args.originalPack as unknown as Prisma.InputJsonValue,
      sourceUserId: args.userId,
      provenanceJson: args.provenanceJson,
      schemaVersion: CREATOR_SCHEMA_VERSION,
    });
    await setUserCreatorPackLinkedGlobalMemory({
      packId: args.packId,
      userId: args.userId,
      globalMemoryId: created.id,
    });
    return created.id;
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "P2002") {
      const existing = await findActiveGlobalCreatorMemoryByLookupKey({
        lookupKey: args.lookupKey,
        packKind: args.packKind,
      });
      if (existing) {
        await setUserCreatorPackLinkedGlobalMemory({
          packId: args.packId,
          userId: args.userId,
          globalMemoryId: existing.id,
        });
        return existing.id;
      }
    }
    console.error("[creator_global_memory_promote_failed]", { userId: args.userId, lookupKey: args.lookupKey, err });
    return undefined;
  }
}

export async function generateCreatorPackOrchestrated(
  userId: string,
  request: CreatorGenerationRequest,
): Promise<CreatorGenerateResponseDto> {
  if (request.learningSessionId) {
    await assertLearningSessionOwned(userId, request.learningSessionId);
  }

  await assertCreatorGenerationBurstLimit(userId);

  const planTier: PlanTier = await getUserPlanTier(userId);
  logProductEvent("creator_generate_start", {
    userId,
    goal: request.goal,
    planTier,
  });
  const packKind = resolvePackKindFromGoal(request.goal, planTier);
  assertCreatorDurationForPack({ packKind, durationSec: request.durationSec, planTier });
  const durationBand = computeDurationBand(request.durationSec, packKind);

  const facets = buildCreatorMemoryKeyFacets({
    topic: request.topic,
    curiosityPrompt: request.curiosityPrompt,
    durationBand,
    targetPlatform: request.targetPlatform,
    presetKey: request.presetKey,
    language: request.language,
    tone: request.tone,
    goal: request.goal,
    packKind,
  });
  const lookupKey = buildCreatorLookupKey(facets);
  const baseCreatorMinutes = estimateBillableCreatorMinutes(request.durationSec);

  if (getEnv().CREATOR_REUSE_ENABLED) {
    const globalRow = await findActiveGlobalCreatorMemoryByLookupKey({ lookupKey, packKind });
    if (globalRow) {
      const parsed = parsePackFromGlobalJson(packKind, globalRow.originalPackJson);
      if (parsed) {
        const reuseDebitMinutes =
          planTier === "free"
            ? null
            : computeCreatorMinuteDebit({
                baseMinutes: baseCreatorMinutes,
                isReuseFromGlobal: true,
              });

        if (planTier === "free") {
          await assertFreeLearningStartAvailable(userId);
        } else {
          await assertProCreatorMinutesAvailable(userId, reuseDebitMinutes!);
        }

        const created = await createUserCreatorPackRow({
          userId,
          learningSessionId: request.learningSessionId ?? null,
          requestJson: { ...requestSummaryForAudit(request), learningSessionId: request.learningSessionId },
          durationBand,
          packKind,
          systemOriginalJson: parsed as unknown as Prisma.InputJsonValue,
          reusedFromGlobalId: globalRow.id,
          linkedGlobalMemoryId: null,
          generationProvenanceJson: {
            source: "reused_global",
            lookupKey,
            globalMemoryId: globalRow.id,
            planTier,
            planPath: describePlanPath({ planTier, packKind }),
            creatorMinutesDebited: reuseDebitMinutes,
            learningStartMetered: planTier === "free",
          },
        });

        if (planTier === "free") {
          try {
            await consumeLearningStart(userId, 1);
          } catch (error) {
            console.error("[creator_learning_start_consume_failed]", { userId, packId: created.id, error });
          }
        } else {
          try {
            await consumeCreatorMinutes(userId, reuseDebitMinutes!);
          } catch (error) {
            console.error("[creator_minutes_consume_failed]", {
              userId,
              packId: created.id,
              minutes: reuseDebitMinutes,
              error,
            });
          }
        }

        logProductEvent("creator_generate_success", {
          userId,
          packId: created.id,
          source: "reused_global",
          planTier,
        });
        return {
          packId: created.id,
          packKind,
          durationBand,
          source: "reused_global",
          planPath: describePlanPath({ planTier, packKind }),
          globalMemoryId: globalRow.id,
          reusedFromGlobalMemoryId: globalRow.id,
          systemOriginal: parsed,
          aiMeta: null,
          usedFallback: false,
          ...(reuseDebitMinutes !== null ? { creatorMinutesDebited: reuseDebitMinutes } : {}),
        };
      }
    }
  }

  const freshDebitMinutes =
    planTier === "free"
      ? null
      : computeCreatorMinuteDebit({
          baseMinutes: baseCreatorMinutes,
          isReuseFromGlobal: false,
        });

  if (planTier === "free") {
    await assertFreeLearningStartAvailable(userId);
  } else {
    await assertProCreatorMinutesAvailable(userId, freshDebitMinutes!);
  }

  const gen = await generateCreatorPackWithAi({
    userId,
    planTier,
    packKind,
    request,
    durationBand,
  });

  const planPath = describePlanPath({ planTier, packKind });
  const generationProvenanceJson: Prisma.InputJsonValue = {
    source: "fresh_generation",
    lookupKey,
    planTier,
    planPath,
    aiMeta: gen.aiMeta,
    usedFallback: gen.usedFallback,
    schemaVersion: CREATOR_SCHEMA_VERSION,
    creatorMinutesDebited: freshDebitMinutes,
    learningStartMetered: planTier === "free",
  };

  const created = await createUserCreatorPackRow({
    userId,
    learningSessionId: request.learningSessionId ?? null,
    requestJson: { ...requestSummaryForAudit(request), learningSessionId: request.learningSessionId },
    durationBand,
    packKind,
    systemOriginalJson: gen.pack as unknown as Prisma.InputJsonValue,
    reusedFromGlobalId: null,
    linkedGlobalMemoryId: null,
    generationProvenanceJson,
  });

  if (planTier === "free") {
    try {
      await consumeLearningStart(userId, 1);
    } catch (error) {
      console.error("[creator_learning_start_consume_failed]", { userId, packId: created.id, error });
    }
  } else {
    try {
      await consumeCreatorMinutes(userId, freshDebitMinutes!);
    } catch (error) {
      console.error("[creator_minutes_consume_failed]", { userId, packId: created.id, minutes: freshDebitMinutes, error });
    }
  }

  const globalMemoryId = await tryPromoteGlobalMemory({
    userId,
    packId: created.id,
    lookupKey,
    facets,
    packKind,
    originalPack: gen.pack,
    provenanceJson: generationProvenanceJson,
  });

  logProductEvent("creator_generate_success", {
    userId,
    packId: created.id,
    source: "fresh_generation",
    planTier,
  });
  return {
    packId: created.id,
    packKind,
    durationBand,
    source: "fresh_generation",
    planPath,
    ...(globalMemoryId ? { globalMemoryId } : {}),
    systemOriginal: gen.pack,
    aiMeta: gen.aiMeta,
    usedFallback: gen.usedFallback,
    ...(freshDebitMinutes !== null ? { creatorMinutesDebited: freshDebitMinutes } : {}),
  };
}

export async function saveUserEditedCreatorPack(args: {
  userId: string;
  packId: string;
  userEditedPack: unknown;
}): Promise<{ packId: string; userEdited: ShortCreatorPack | LongCreatorPack }> {
  const row = await findUserCreatorPackOwned({ userId: args.userId, packId: args.packId });
  if (!row) {
    throw new AppError(404, "Creator pack not found", { code: "NOT_FOUND" });
  }

  if (row.packKind === "SHORT_FORM") {
    const parsed = shortCreatorPackSchema.safeParse(args.userEditedPack);
    if (!parsed.success) {
      throw new AppError(400, "Edited pack does not match short creator schema or duration-safe shape.", {
        code: "CREATOR_VALIDATION_ERROR",
        details: parsed.error.flatten(),
      });
    }
    const n = await updateUserCreatorPackEditedJson({
      packId: args.packId,
      userId: args.userId,
      userEditedJson: parsed.data as unknown as Prisma.InputJsonValue,
    });
    if (n !== 1) {
      throw new AppError(404, "Creator pack not found", { code: "NOT_FOUND" });
    }
    return { packId: args.packId, userEdited: parsed.data };
  }

  const parsed = longCreatorPackSchema.safeParse(args.userEditedPack);
  if (!parsed.success) {
    throw new AppError(400, "Edited pack does not match long creator schema.", {
      code: "CREATOR_VALIDATION_ERROR",
      details: parsed.error.flatten(),
    });
  }
  const n = await updateUserCreatorPackEditedJson({
    packId: args.packId,
    userId: args.userId,
    userEditedJson: parsed.data as unknown as Prisma.InputJsonValue,
  });
  if (n !== 1) {
    throw new AppError(404, "Creator pack not found", { code: "NOT_FOUND" });
  }
  return { packId: args.packId, userEdited: parsed.data };
}

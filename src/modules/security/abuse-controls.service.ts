import { getEnv } from "../../config/env";
import { AppError } from "../../lib/errors";
import { logProductEvent } from "../../lib/product-log";
import { countActiveRenderJobsForUser, countActiveRenderJobsForUserAndPack } from "../render/repositories/render-job.repository";
import { countUserCreatorPacksCreatedSince } from "../creator/repositories/user-creator-pack.repository";

export type RenderAbuseEvaluation =
  | { ok: true }
  | { ok: false; httpStatus: number; code: string; message: string };

/**
 * Pure decision helper (unit-tested) for concurrent render caps.
 */
export function evaluateRenderSubmissionAbuse(args: {
  activeJobsUser: number;
  activeJobsForPack: number;
  maxActiveUser: number;
  maxActivePerPack: number;
}): RenderAbuseEvaluation {
  const { activeJobsUser, activeJobsForPack, maxActiveUser, maxActivePerPack } = args;
  if (maxActiveUser > 0 && activeJobsUser >= maxActiveUser) {
    return {
      ok: false,
      httpStatus: 429,
      code: "RENDER_TOO_MANY_ACTIVE_JOBS",
      message:
        "You already have several video renders in progress. Wait for one to finish or fail before starting another.",
    };
  }
  if (maxActivePerPack > 0 && activeJobsForPack >= maxActivePerPack) {
    return {
      ok: false,
      httpStatus: 409,
      code: "RENDER_ACTIVE_JOB_FOR_PACK",
      message: "A render is already in progress for this creator pack. Check status or wait for it to complete.",
    };
  }
  return { ok: true };
}

export async function assertRenderSubmissionAbuseControls(args: {
  userId: string;
  creatorPackId: string;
}): Promise<void> {
  const env = getEnv();
  const maxUser = env.RENDER_ABUSE_MAX_ACTIVE_JOBS_PER_USER;
  const maxPack = env.RENDER_ABUSE_MAX_ACTIVE_JOBS_PER_PACK;
  if (maxUser <= 0 && maxPack <= 0) {
    return;
  }
  const [activeUser, activePack] = await Promise.all([
    countActiveRenderJobsForUser(args.userId),
    countActiveRenderJobsForUserAndPack({ userId: args.userId, creatorPackId: args.creatorPackId }),
  ]);
  const d = evaluateRenderSubmissionAbuse({
    activeJobsUser: activeUser,
    activeJobsForPack: activePack,
    maxActiveUser: maxUser,
    maxActivePerPack: maxPack,
  });
  if (!d.ok) {
    logProductEvent("abuse_denied", {
      kind: "render_submit",
      userId: args.userId,
      creatorPackId: args.creatorPackId,
      code: d.code,
      activeUser,
      activePack,
    });
    throw new AppError(d.httpStatus, d.message, { code: d.code });
  }
}

export async function assertCreatorGenerationBurstLimit(userId: string): Promise<void> {
  const env = getEnv();
  const max = env.CREATOR_ABUSE_MAX_PACKS_PER_WINDOW;
  if (max <= 0) {
    return;
  }
  const windowMs = env.CREATOR_ABUSE_WINDOW_MINUTES * 60_000;
  const since = new Date(Date.now() - windowMs);
  const n = await countUserCreatorPacksCreatedSince({ userId, since });
  if (n >= max) {
    logProductEvent("abuse_denied", {
      kind: "creator_pack_burst",
      userId,
      count: n,
      windowMinutes: env.CREATOR_ABUSE_WINDOW_MINUTES,
      limit: max,
    });
    throw new AppError(
      429,
      "Too many creator packs were created in a short period. Please wait a few minutes before generating again.",
      {
        code: "CREATOR_GENERATION_BURST_LIMIT",
        details: {
          windowMinutes: env.CREATOR_ABUSE_WINDOW_MINUTES,
          limit: max,
        },
      },
    );
  }
}

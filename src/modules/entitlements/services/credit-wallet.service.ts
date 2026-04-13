import type { Prisma } from "@prisma/client";
import { AppError } from "../../../lib/errors";
import {
  createUserCreditWalletRow,
  decrementRenderCreditsIfSufficient,
  findUserCreditWalletRow,
  incrementRenderCredits,
} from "../repositories/user-credit-wallet.repository";
import { getStarterRenderCreditsPolicy, getUserPlanTier } from "./entitlement.service";

export async function getOrCreateUserCreditWallet(userId: string): Promise<{
  renderCreditsBalance: number;
  bonusCreditsBalance: number | null;
}> {
  const existing = await findUserCreditWalletRow(userId);
  if (existing) {
    return {
      renderCreditsBalance: existing.renderCreditsBalance,
      bonusCreditsBalance: existing.bonusCreditsBalance,
    };
  }
  const planTier = await getUserPlanTier(userId);
  const starter = getStarterRenderCreditsPolicy(planTier);
  await createUserCreditWalletRow({
    userId,
    renderCreditsBalance: starter,
    bonusCreditsBalance: null,
    initialBalanceLedgerReason: starter > 0 ? "starter_render_credits_by_plan_tier" : null,
  });
  return { renderCreditsBalance: starter, bonusCreditsBalance: null };
}

export async function getRenderCreditBalance(userId: string): Promise<number> {
  const w = await getOrCreateUserCreditWallet(userId);
  return w.renderCreditsBalance;
}

export async function canConsumeRenderCredits(
  userId: string,
  amount: number,
): Promise<{ ok: true; balance: number } | { ok: false; balance: number }> {
  const need = Math.max(0, Math.ceil(amount));
  const w = await getOrCreateUserCreditWallet(userId);
  if (w.renderCreditsBalance >= need) {
    return { ok: true, balance: w.renderCreditsBalance };
  }
  return { ok: false, balance: w.renderCreditsBalance };
}

export async function consumeRenderCredits(
  userId: string,
  amount: number,
  meta?: { reason?: string; source?: string },
): Promise<void> {
  const res = await decrementRenderCreditsIfSufficient({
    userId,
    amount,
    reason: meta?.reason ?? null,
    source: meta?.source ?? null,
  });
  if (!res.ok) {
    throw new AppError(402, "Insufficient render credits", {
      code: "RENDER_CREDITS_EXHAUSTED",
      details: { balance: res.balance },
    });
  }
}

export async function grantRenderCredits(
  userId: string,
  amount: number,
  meta?: {
    reason?: string | null;
    source?: string | null;
    entryType?: "GRANT" | "PURCHASE" | "ADJUSTMENT";
    metadataJson?: Prisma.InputJsonValue | null;
  },
): Promise<void> {
  await getOrCreateUserCreditWallet(userId);
  const payload: {
    userId: string;
    amount: number;
    entryType: "GRANT" | "PURCHASE" | "ADJUSTMENT";
    reason: string;
    source: string;
    metadataJson?: Prisma.InputJsonValue | null;
  } = {
    userId,
    amount,
    entryType: meta?.entryType ?? "GRANT",
    reason: meta?.reason ?? "grant",
    source: meta?.source ?? "credit_wallet_service",
  };
  if (meta?.metadataJson !== undefined) {
    payload.metadataJson = meta.metadataJson;
  }
  await incrementRenderCredits(payload);
}

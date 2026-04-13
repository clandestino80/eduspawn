import type { CreditLedgerEntryType, Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

type Tx = Prisma.TransactionClient;

export async function findUserCreditWalletRow(userId: string): Promise<{
  id: string;
  renderCreditsBalance: number;
  bonusCreditsBalance: number | null;
} | null> {
  return prisma.userCreditWallet.findUnique({
    where: { userId },
    select: {
      id: true,
      renderCreditsBalance: true,
      bonusCreditsBalance: true,
    },
  });
}

export async function createUserCreditWalletRow(params: {
  userId: string;
  renderCreditsBalance: number;
  bonusCreditsBalance?: number | null;
  /** Ledger line when opening balance is non-zero (audit trail). */
  initialBalanceLedgerReason?: string | null;
}): Promise<void> {
  const bonus = params.bonusCreditsBalance ?? null;
  const initial = params.renderCreditsBalance;
  await prisma.$transaction(async (tx) => {
    await tx.userCreditWallet.create({
      data: {
        userId: params.userId,
        renderCreditsBalance: initial,
        bonusCreditsBalance: bonus,
      },
    });
    if (initial !== 0) {
      await tx.userCreditLedgerEntry.create({
        data: {
          userId: params.userId,
          amount: initial,
          balanceAfter: initial,
          entryType: "GRANT",
          reason: params.initialBalanceLedgerReason ?? "initial_wallet_balance",
          source: "wallet_create",
        },
      });
    }
  });
}

export async function decrementRenderCreditsInTx(
  tx: Tx,
  params: {
    userId: string;
    amount: number;
    reason?: string | null;
    source?: string | null;
    metadataJson?: Prisma.InputJsonValue | null;
  },
): Promise<
  { ok: true; ledgerEntryId: string; balanceAfter: number } | { ok: false; balance: number }
> {
  const amount = Math.max(0, Math.ceil(params.amount));
  if (amount === 0) {
    throw new Error("decrementRenderCreditsInTx requires a positive debit amount");
  }
  const row = await tx.userCreditWallet.findUnique({
    where: { userId: params.userId },
    select: { renderCreditsBalance: true },
  });
  if (!row) {
    return { ok: false, balance: 0 };
  }
  if (row.renderCreditsBalance < amount) {
    return { ok: false, balance: row.renderCreditsBalance };
  }
  const updated = await tx.userCreditWallet.update({
    where: { userId: params.userId },
    data: { renderCreditsBalance: { decrement: amount } },
    select: { renderCreditsBalance: true },
  });
  const entry = await tx.userCreditLedgerEntry.create({
    data: {
      userId: params.userId,
      amount: -amount,
      balanceAfter: updated.renderCreditsBalance,
      entryType: "CONSUMPTION",
      reason: params.reason ?? null,
      source: params.source ?? "render",
      metadataJson: params.metadataJson === undefined ? undefined : params.metadataJson,
    },
    select: { id: true },
  });
  return { ok: true, ledgerEntryId: entry.id, balanceAfter: updated.renderCreditsBalance };
}

export async function decrementRenderCreditsIfSufficient(params: {
  userId: string;
  amount: number;
  reason?: string | null;
  source?: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
}): Promise<{ ok: true } | { ok: false; balance: number }> {
  const amount = Math.max(0, Math.ceil(params.amount));
  if (amount === 0) {
    return { ok: true };
  }
  return prisma.$transaction(async (tx) => {
    const res = await decrementRenderCreditsInTx(tx, params);
    if (!res.ok) {
      return { ok: false as const, balance: res.balance };
    }
    return { ok: true as const };
  });
}

export async function incrementRenderCreditsInTx(
  tx: Tx,
  params: {
    userId: string;
    amount: number;
    entryType?: CreditLedgerEntryType;
    reason?: string | null;
    source?: string | null;
    metadataJson?: Prisma.InputJsonValue | null;
  },
): Promise<{ ledgerEntryId: string; balanceAfter: number }> {
  const amount = Math.max(0, Math.ceil(params.amount));
  if (amount === 0) {
    const w = await tx.userCreditWallet.findUnique({
      where: { userId: params.userId },
      select: { renderCreditsBalance: true },
    });
    return { ledgerEntryId: "", balanceAfter: w?.renderCreditsBalance ?? 0 };
  }
  const updated = await tx.userCreditWallet.update({
    where: { userId: params.userId },
    data: { renderCreditsBalance: { increment: amount } },
    select: { renderCreditsBalance: true },
  });
  const entry = await tx.userCreditLedgerEntry.create({
    data: {
      userId: params.userId,
      amount,
      balanceAfter: updated.renderCreditsBalance,
      entryType: params.entryType ?? "GRANT",
      reason: params.reason ?? null,
      source: params.source ?? null,
      metadataJson: params.metadataJson === undefined ? undefined : params.metadataJson,
    },
    select: { id: true },
  });
  return { ledgerEntryId: entry.id, balanceAfter: updated.renderCreditsBalance };
}

export async function incrementRenderCredits(params: {
  userId: string;
  amount: number;
  entryType?: CreditLedgerEntryType;
  reason?: string | null;
  source?: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
}): Promise<void> {
  const amount = Math.max(0, Math.ceil(params.amount));
  if (amount === 0) return;
  await prisma.$transaction(async (tx) => {
    await incrementRenderCreditsInTx(tx, params);
  });
}

import { prisma } from "../../../lib/prisma";

export async function findUserCheckoutContext(userId: string): Promise<{
  email: string;
  stripeCustomerId: string | null;
} | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, stripeCustomerId: true },
  });
}

export async function findUserIdByStripeCustomerId(stripeCustomerId: string): Promise<string | null> {
  const row = await prisma.user.findFirst({
    where: { stripeCustomerId },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Links Stripe customer to user (idempotent if same user). Ignores unique conflicts from another user.
 */
export async function trySetUserStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });
  if (existing?.stripeCustomerId === stripeCustomerId) {
    return;
  }
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId },
    });
  } catch {
    /* Another row may already own this customer id — webhook still applied entitlement. */
  }
}

-- Billing / entitlements foundation: persisted plan tier + credit ledger audit trail.

CREATE TYPE "BillingPlanTier" AS ENUM ('FREE', 'PRO', 'PREMIUM');
CREATE TYPE "BillingSubscriptionStatus" AS ENUM ('NONE', 'ACTIVE', 'CANCELED', 'PAST_DUE', 'TRIALING');
CREATE TYPE "EntitlementSource" AS ENUM ('DEFAULT', 'MANUAL', 'WEB_STRIPE', 'APPLE_IAP', 'GOOGLE_PLAY', 'PROMO');
CREATE TYPE "CreditLedgerEntryType" AS ENUM ('GRANT', 'PURCHASE', 'ADJUSTMENT', 'CONSUMPTION');

CREATE TABLE "UserBillingEntitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planTier" "BillingPlanTier" NOT NULL DEFAULT 'FREE',
    "subscriptionStatus" "BillingSubscriptionStatus" NOT NULL DEFAULT 'NONE',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "entitlementSource" "EntitlementSource" NOT NULL DEFAULT 'DEFAULT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBillingEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserBillingEntitlement_userId_key" ON "UserBillingEntitlement"("userId");
CREATE INDEX "UserBillingEntitlement_userId_idx" ON "UserBillingEntitlement"("userId");

ALTER TABLE "UserBillingEntitlement" ADD CONSTRAINT "UserBillingEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserCreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER,
    "entryType" "CreditLedgerEntryType" NOT NULL,
    "reason" VARCHAR(256),
    "source" VARCHAR(64),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserCreditLedgerEntry_userId_createdAt_idx" ON "UserCreditLedgerEntry"("userId", "createdAt");

ALTER TABLE "UserCreditLedgerEntry" ADD CONSTRAINT "UserCreditLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

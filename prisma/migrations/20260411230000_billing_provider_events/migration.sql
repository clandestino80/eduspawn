-- Provider-agnostic billing webhook ingestion + Stripe customer link on User.

CREATE TYPE "BillingProvider" AS ENUM ('STRIPE', 'APPLE', 'GOOGLE', 'MANUAL');
CREATE TYPE "BillingProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

CREATE TABLE "BillingProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" VARCHAR(128) NOT NULL,
    "normalizedEventType" VARCHAR(64) NOT NULL,
    "userId" TEXT,
    "externalCustomerId" VARCHAR(255),
    "externalSubscriptionId" VARCHAR(255),
    "externalProductId" VARCHAR(255),
    "payloadJson" JSONB NOT NULL,
    "processingStatus" "BillingProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingProviderEvent_provider_providerEventId_key" ON "BillingProviderEvent"("provider", "providerEventId");
CREATE INDEX "BillingProviderEvent_provider_createdAt_idx" ON "BillingProviderEvent"("provider", "createdAt");
CREATE INDEX "BillingProviderEvent_userId_idx" ON "BillingProviderEvent"("userId");

ALTER TABLE "BillingProviderEvent" ADD CONSTRAINT "BillingProviderEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

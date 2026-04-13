-- Render pipeline foundation: job tracking + credit linkage

CREATE TYPE "RenderJobStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED');
CREATE TYPE "RenderProviderKind" AS ENUM ('KLING', 'KLING_STUB');
CREATE TYPE "RenderPackSourceIntent" AS ENUM ('SYSTEM_ORIGINAL', 'USER_EDITED_PRIVATE');

CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creatorPackId" TEXT NOT NULL,
    "learningSessionId" TEXT,
    "provider" "RenderProviderKind" NOT NULL,
    "providerJobId" VARCHAR(512),
    "status" "RenderJobStatus" NOT NULL DEFAULT 'QUEUED',
    "renderKind" VARCHAR(64) NOT NULL,
    "targetDurationSec" INTEGER NOT NULL,
    "targetPlatform" VARCHAR(64) NOT NULL,
    "requestedWithEditedPack" BOOLEAN NOT NULL,
    "sourcePackIntent" "RenderPackSourceIntent" NOT NULL,
    "creditCost" INTEGER NOT NULL,
    "consumedCreditLedgerEntryId" TEXT,
    "refundLedgerEntryId" TEXT,
    "outputUrl" TEXT,
    "thumbnailUrl" TEXT,
    "metadataJson" JSONB,
    "failureReason" TEXT,
    "idempotencyKey" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RenderJob_consumedCreditLedgerEntryId_key" ON "RenderJob"("consumedCreditLedgerEntryId");
CREATE UNIQUE INDEX "RenderJob_refundLedgerEntryId_key" ON "RenderJob"("refundLedgerEntryId");
CREATE UNIQUE INDEX "RenderJob_userId_idempotencyKey_key" ON "RenderJob"("userId", "idempotencyKey");
CREATE INDEX "RenderJob_userId_createdAt_idx" ON "RenderJob"("userId", "createdAt");
CREATE INDEX "RenderJob_creatorPackId_idx" ON "RenderJob"("creatorPackId");
CREATE INDEX "RenderJob_provider_providerJobId_idx" ON "RenderJob"("provider", "providerJobId");

ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_creatorPackId_fkey" FOREIGN KEY ("creatorPackId") REFERENCES "UserCreatorPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_learningSessionId_fkey" FOREIGN KEY ("learningSessionId") REFERENCES "LearningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

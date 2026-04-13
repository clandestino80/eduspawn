-- Slice A: global memory-first topic inventory, user topic state, batches, metered usage, credit wallet.
-- No data backfill; additive only.

CREATE TYPE "GlobalTopicSourceType" AS ENUM ('SYSTEM_SEED', 'USER_GENERATED', 'SYSTEM_REPLENISH', 'TREND_REFRESH');
CREATE TYPE "GlobalTopicStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "UserTopicInteractionType" AS ENUM ('SEEN', 'OPENED', 'GENERATED', 'DISMISSED', 'SAVED');
CREATE TYPE "TopicInventoryBatchType" AS ENUM ('BOOTSTRAP', 'REPLENISH', 'TREND_REFRESH', 'USER_PROMOTION');
CREATE TYPE "TopicInventoryBatchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "GlobalTopicInventory" (
    "id" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "curiosityHook" TEXT,
    "shortSummary" TEXT,
    "domain" TEXT,
    "subdomain" TEXT,
    "microTopic" TEXT,
    "categoryLabel" TEXT,
    "sourceType" "GlobalTopicSourceType" NOT NULL,
    "status" "GlobalTopicStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceUserId" TEXT,
    "sourceLearningSessionId" TEXT,
    "globalConceptId" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "reuseEligible" BOOLEAN NOT NULL DEFAULT true,
    "freshnessBucket" TEXT,
    "timesSuggested" INTEGER NOT NULL DEFAULT 0,
    "timesOpened" INTEGER NOT NULL DEFAULT 0,
    "timesGenerated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalTopicInventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalTopicInventory_normalizedKey_key" ON "GlobalTopicInventory"("normalizedKey");
CREATE INDEX "GlobalTopicInventory_status_reuseEligible_idx" ON "GlobalTopicInventory"("status", "reuseEligible");
CREATE INDEX "GlobalTopicInventory_domain_subdomain_idx" ON "GlobalTopicInventory"("domain", "subdomain");
CREATE INDEX "GlobalTopicInventory_sourceType_idx" ON "GlobalTopicInventory"("sourceType");
CREATE INDEX "GlobalTopicInventory_globalConceptId_idx" ON "GlobalTopicInventory"("globalConceptId");
CREATE INDEX "GlobalTopicInventory_createdAt_idx" ON "GlobalTopicInventory"("createdAt");

ALTER TABLE "GlobalTopicInventory" ADD CONSTRAINT "GlobalTopicInventory_sourceUserId_fkey" FOREIGN KEY ("sourceUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GlobalTopicInventory" ADD CONSTRAINT "GlobalTopicInventory_sourceLearningSessionId_fkey" FOREIGN KEY ("sourceLearningSessionId") REFERENCES "LearningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GlobalTopicInventory" ADD CONSTRAINT "GlobalTopicInventory_globalConceptId_fkey" FOREIGN KEY ("globalConceptId") REFERENCES "GlobalConcept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "UserTopicState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "globalTopicId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3),
    "lastInteractionType" "UserTopicInteractionType",
    "seenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTopicState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserTopicState_userId_globalTopicId_key" ON "UserTopicState"("userId", "globalTopicId");
CREATE INDEX "UserTopicState_userId_idx" ON "UserTopicState"("userId");
CREATE INDEX "UserTopicState_userId_lastSeenAt_idx" ON "UserTopicState"("userId", "lastSeenAt");
CREATE INDEX "UserTopicState_globalTopicId_idx" ON "UserTopicState"("globalTopicId");

ALTER TABLE "UserTopicState" ADD CONSTRAINT "UserTopicState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTopicState" ADD CONSTRAINT "UserTopicState_globalTopicId_fkey" FOREIGN KEY ("globalTopicId") REFERENCES "GlobalTopicInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TopicInventoryBatch" (
    "id" TEXT NOT NULL,
    "batchType" "TopicInventoryBatchType" NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "domainHint" TEXT,
    "subdomainHint" TEXT,
    "status" "TopicInventoryBatchStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicInventoryBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TopicInventoryBatch_status_batchType_idx" ON "TopicInventoryBatch"("status", "batchType");
CREATE INDEX "TopicInventoryBatch_createdAt_idx" ON "TopicInventoryBatch"("createdAt");

CREATE TABLE "UserGenerationUsageDaily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "freshGenerationsUsed" INTEGER NOT NULL DEFAULT 0,
    "gpt4oMiniShortPacksUsed" INTEGER NOT NULL DEFAULT 0,
    "gpt54ShortPacksUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGenerationUsageDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserGenerationUsageDaily_userId_usageDate_key" ON "UserGenerationUsageDaily"("userId", "usageDate");
CREATE INDEX "UserGenerationUsageDaily_userId_idx" ON "UserGenerationUsageDaily"("userId");

ALTER TABLE "UserGenerationUsageDaily" ADD CONSTRAINT "UserGenerationUsageDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserCreatorUsageMonthly" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodMonth" VARCHAR(7) NOT NULL,
    "creatorMinutesUsed" INTEGER NOT NULL DEFAULT 0,
    "premiumGenerationsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCreatorUsageMonthly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserCreatorUsageMonthly_userId_periodMonth_key" ON "UserCreatorUsageMonthly"("userId", "periodMonth");
CREATE INDEX "UserCreatorUsageMonthly_userId_idx" ON "UserCreatorUsageMonthly"("userId");

ALTER TABLE "UserCreatorUsageMonthly" ADD CONSTRAINT "UserCreatorUsageMonthly_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserCreditWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "renderCreditsBalance" INTEGER NOT NULL DEFAULT 0,
    "bonusCreditsBalance" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCreditWallet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserCreditWallet_userId_key" ON "UserCreditWallet"("userId");

ALTER TABLE "UserCreditWallet" ADD CONSTRAINT "UserCreditWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

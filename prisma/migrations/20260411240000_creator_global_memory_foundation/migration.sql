-- Creator layer: global reusable system-generated packs + per-user private edits.

CREATE TYPE "CreatorPackKind" AS ENUM ('SHORT_FORM', 'LONG_FORM');
CREATE TYPE "CreatorGlobalMemoryPromotionStatus" AS ENUM ('NONE', 'CANDIDATE', 'ACTIVE', 'REJECTED');

CREATE TABLE "GlobalCreatorMemory" (
    "id" TEXT NOT NULL,
    "lookupKey" TEXT NOT NULL,
    "keyFacetsJson" JSONB NOT NULL,
    "packKind" "CreatorPackKind" NOT NULL,
    "originalPackJson" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "promotionStatus" "CreatorGlobalMemoryPromotionStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceUserId" TEXT,
    "provenanceJson" JSONB,
    "qualitySignalsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalCreatorMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalCreatorMemory_lookupKey_key" ON "GlobalCreatorMemory"("lookupKey");
CREATE INDEX "GlobalCreatorMemory_packKind_promotionStatus_idx" ON "GlobalCreatorMemory"("packKind", "promotionStatus");
CREATE INDEX "GlobalCreatorMemory_createdAt_idx" ON "GlobalCreatorMemory"("createdAt");

ALTER TABLE "GlobalCreatorMemory" ADD CONSTRAINT "GlobalCreatorMemory_sourceUserId_fkey" FOREIGN KEY ("sourceUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "UserCreatorPack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "learningSessionId" TEXT,
    "requestJson" JSONB NOT NULL,
    "durationBand" VARCHAR(32) NOT NULL,
    "packKind" "CreatorPackKind" NOT NULL,
    "systemOriginalJson" JSONB NOT NULL,
    "userEditedJson" JSONB,
    "reusedFromGlobalId" TEXT,
    "linkedGlobalMemoryId" TEXT,
    "generationProvenanceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCreatorPack_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserCreatorPack_userId_createdAt_idx" ON "UserCreatorPack"("userId", "createdAt");
CREATE INDEX "UserCreatorPack_learningSessionId_idx" ON "UserCreatorPack"("learningSessionId");

ALTER TABLE "UserCreatorPack" ADD CONSTRAINT "UserCreatorPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCreatorPack" ADD CONSTRAINT "UserCreatorPack_learningSessionId_fkey" FOREIGN KEY ("learningSessionId") REFERENCES "LearningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserCreatorPack" ADD CONSTRAINT "UserCreatorPack_reusedFromGlobalId_fkey" FOREIGN KEY ("reusedFromGlobalId") REFERENCES "GlobalCreatorMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserCreatorPack" ADD CONSTRAINT "UserCreatorPack_linkedGlobalMemoryId_fkey" FOREIGN KEY ("linkedGlobalMemoryId") REFERENCES "GlobalCreatorMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

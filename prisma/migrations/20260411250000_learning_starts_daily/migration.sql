-- Free tier: daily learning starts (product allowance), separate counter from paid-tier daily fresh-gen meter.

ALTER TABLE "UserGenerationUsageDaily" ADD COLUMN "learningStartsUsed" INTEGER NOT NULL DEFAULT 0;

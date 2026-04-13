-- Slice G: optional link from a learning session to the feed inventory topic it was started from.

ALTER TABLE "LearningSession" ADD COLUMN "sourceGlobalTopicId" TEXT;

CREATE INDEX "LearningSession_sourceGlobalTopicId_idx" ON "LearningSession"("sourceGlobalTopicId");

ALTER TABLE "LearningSession"
ADD CONSTRAINT "LearningSession_sourceGlobalTopicId_fkey"
FOREIGN KEY ("sourceGlobalTopicId") REFERENCES "GlobalTopicInventory"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

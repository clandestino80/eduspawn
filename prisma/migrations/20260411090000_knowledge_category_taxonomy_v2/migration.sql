-- AlterTable: Slice H — Category Engine V2 taxonomy fields on KnowledgeCategory
ALTER TABLE "KnowledgeCategory" ADD COLUMN "domain" TEXT;
ALTER TABLE "KnowledgeCategory" ADD COLUMN "subdomain" TEXT;
ALTER TABLE "KnowledgeCategory" ADD COLUMN "microTopic" TEXT;
ALTER TABLE "KnowledgeCategory" ADD COLUMN "difficultySignal" TEXT;
ALTER TABLE "KnowledgeCategory" ADD COLUMN "formatAffinity" TEXT;
ALTER TABLE "KnowledgeCategory" ADD COLUMN "intentHint" TEXT;

CREATE INDEX "KnowledgeCategory_userId_domain_idx" ON "KnowledgeCategory"("userId", "domain");

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('LEARNING_SESSION');

-- CreateEnum
CREATE TYPE "KnowledgeNodeKind" AS ENUM ('SESSION_LESSON');

-- CreateTable
CREATE TABLE "KnowledgeCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceSessionId" TEXT,
    "weight" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeNode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "kind" "KnowledgeNodeKind" NOT NULL DEFAULT 'SESSION_LESSON',
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "categoryId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeCategory_userId_idx" ON "KnowledgeCategory"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeCategory_userId_updatedAt_idx" ON "KnowledgeCategory"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "KnowledgeCategory_sourceSessionId_idx" ON "KnowledgeCategory"("sourceSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCategory_userId_normalizedKey_key" ON "KnowledgeCategory"("userId", "normalizedKey");

-- CreateIndex
CREATE INDEX "KnowledgeNode_userId_createdAt_idx" ON "KnowledgeNode"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeNode_userId_sourceType_idx" ON "KnowledgeNode"("userId", "sourceType");

-- CreateIndex
CREATE INDEX "KnowledgeNode_categoryId_idx" ON "KnowledgeNode"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeNode_userId_sourceType_sourceId_key" ON "KnowledgeNode"("userId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "KnowledgeCategory" ADD CONSTRAINT "KnowledgeCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCategory" ADD CONSTRAINT "KnowledgeCategory_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "LearningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNode" ADD CONSTRAINT "KnowledgeNode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNode" ADD CONSTRAINT "KnowledgeNode_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "KnowledgeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Slice J — Global Wiki bridge: GlobalConcept + optional KnowledgeCategory.globalConceptId

CREATE TABLE "GlobalConcept" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayTitle" TEXT NOT NULL,
    "domain" TEXT,
    "subdomain" TEXT,
    "microTopic" TEXT,
    "mappingKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalConcept_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalConcept_slug_key" ON "GlobalConcept"("slug");

CREATE INDEX "GlobalConcept_domain_idx" ON "GlobalConcept"("domain");

CREATE INDEX "GlobalConcept_mappingKey_idx" ON "GlobalConcept"("mappingKey");

ALTER TABLE "KnowledgeCategory" ADD COLUMN "globalConceptId" TEXT;

CREATE INDEX "KnowledgeCategory_globalConceptId_idx" ON "KnowledgeCategory"("globalConceptId");

ALTER TABLE "KnowledgeCategory" ADD CONSTRAINT "KnowledgeCategory_globalConceptId_fkey" FOREIGN KEY ("globalConceptId") REFERENCES "GlobalConcept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

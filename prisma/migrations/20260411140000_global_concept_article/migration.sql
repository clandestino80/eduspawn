-- GlobalConceptArticle — first reusable article layer on GlobalConcept (V1 seed)

CREATE TABLE "GlobalConceptArticle" (
    "id" TEXT NOT NULL,
    "globalConceptId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT NOT NULL,
    "hook" TEXT,
    "relatedQuestionsJson" JSONB,
    "sourceType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalConceptArticle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalConceptArticle_globalConceptId_key" ON "GlobalConceptArticle"("globalConceptId");

ALTER TABLE "GlobalConceptArticle" ADD CONSTRAINT "GlobalConceptArticle_globalConceptId_fkey" FOREIGN KEY ("globalConceptId") REFERENCES "GlobalConcept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

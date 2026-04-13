-- Optional AI enrichment audit for GlobalConceptArticle (deterministic seed remains baseline).
ALTER TABLE "GlobalConceptArticle" ADD COLUMN "enrichmentProvenanceJson" JSONB;

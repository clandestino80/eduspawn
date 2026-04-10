-- CreateTable
CREATE TABLE "ContentShare" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentOutputId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "shareCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentShare_userId_contentOutputId_platform_key" ON "ContentShare"("userId", "contentOutputId", "platform");

-- AddForeignKey
ALTER TABLE "ContentShare" ADD CONSTRAINT "ContentShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentShare" ADD CONSTRAINT "ContentShare_contentOutputId_fkey" FOREIGN KEY ("contentOutputId") REFERENCES "ContentOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

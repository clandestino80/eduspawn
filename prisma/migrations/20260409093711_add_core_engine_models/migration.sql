-- CreateTable
CREATE TABLE "LearningDNA" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferredTone" TEXT,
    "preferredDifficulty" TEXT,
    "favoriteTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attentionSpanSeconds" INTEGER,
    "visualPreference" TEXT,
    "quizPreference" TEXT,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningDNA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "curiosityPrompt" TEXT NOT NULL,
    "lessonTitle" TEXT,
    "lessonSummary" TEXT,
    "lessonBody" TEXT,
    "difficulty" TEXT,
    "tone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "learningSessionId" TEXT NOT NULL,
    "score" INTEGER,
    "totalQuestions" INTEGER,
    "answersJson" JSONB,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentOutput" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "learningSessionId" TEXT NOT NULL,
    "outputType" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningDNA_userId_key" ON "LearningDNA"("userId");

-- AddForeignKey
ALTER TABLE "LearningDNA" ADD CONSTRAINT "LearningDNA_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_learningSessionId_fkey" FOREIGN KEY ("learningSessionId") REFERENCES "LearningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOutput" ADD CONSTRAINT "ContentOutput_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOutput" ADD CONSTRAINT "ContentOutput_learningSessionId_fkey" FOREIGN KEY ("learningSessionId") REFERENCES "LearningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

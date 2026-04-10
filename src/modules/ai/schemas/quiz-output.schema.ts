import { z } from "zod";

export const mcqQuestionSchema = z.object({
  type: z.literal("mcq"),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  answer: z.string().min(1),
  explanation: z.string().min(1),
});

export const quizGenerationOutputSchema = z.object({
  questions: z.array(mcqQuestionSchema).min(1).max(20),
});

export const assessmentMetaSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  routeReason: z.string().min(1),
  questionCount: z.number().int().nonnegative(),
});

export type McqQuestion = z.infer<typeof mcqQuestionSchema>;
export type QuizGenerationOutput = z.infer<typeof quizGenerationOutputSchema>;
export type AssessmentMeta = z.infer<typeof assessmentMetaSchema>;

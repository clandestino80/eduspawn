/**
 * Deterministic payload for persisting a generated lesson into the Personal Brain (V1).
 * No LLM output beyond fields already produced by the lesson pipeline.
 */
export type PersistGeneratedLessonKnowledgeInput = {
  userId: string;
  session: {
    id: string;
    topic: string;
    curiosityPrompt: string;
    /** Optional session difficulty for Slice H taxonomy (difficultySignal). */
    difficulty?: string | null;
  };
  lesson: {
    lessonTitle: string;
    lessonSummary: string;
    lessonBody: string;
    wowFacts: readonly string[];
  };
};

/** Deterministic hint for how to use retrieved memories in lesson prompts (V1). */
export type LessonPersonalMemoryLearningGoalMode =
  | "novelty"
  | "reinforcement"
  | "gentle_repetition";

/**
 * Compact, generation-safe memory context for lesson AI (Slice B + G).
 * Future: global wiki snippets.
 */
export type LessonPersonalMemoryContext = {
  learningGoalMode: LessonPersonalMemoryLearningGoalMode;
  /** Short lines only; already truncated for prompt safety. */
  memoryBullets: string[];
  /**
   * Slice G — optional 1-hop graph neighbors (RELATED_TO / REINFORCES), compact lines for the prompt only.
   */
  graphHints?: string[];
  /**
   * Slice H — one optional coarse line for the current topic thread (deterministic; prompt only).
   */
  categoryTaxonomyHint?: string;
};

export type AssembleLessonPersonalMemoryContextInput = {
  userId: string;
  session: {
    id: string;
    topic: string;
    curiosityPrompt: string;
  };
};

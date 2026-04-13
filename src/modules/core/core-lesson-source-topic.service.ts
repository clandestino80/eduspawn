import { markTopicGenerated } from "../knowledge-engine/services/user-topic-state.service";

/**
 * Slice G — after a lesson is successfully generated, persist feed linkage as GENERATED for exclusion.
 * Failures are isolated so lesson delivery is never blocked.
 */
export async function applySourceTopicGeneratedAfterLesson(params: {
  userId: string;
  sourceGlobalTopicId: string | null;
}): Promise<void> {
  const id = params.sourceGlobalTopicId;
  if (!id) {
    return;
  }
  try {
    await markTopicGenerated({
      userId: params.userId,
      globalTopicId: id,
    });
  } catch (error) {
    console.error("[topic_state_mark_generated_from_lesson_failed]", {
      userId: params.userId,
      globalTopicId: id,
      error,
    });
  }
}

export type GeneratedLesson = {
  lessonTitle: string;
  lessonSummary: string;
  lessonBody: string;
  wowFacts: string[];
  quizQuestions: {
    type: "mcq";
    question: string;
    options: string[];
    answer: string;
  }[];
};

export function generateLesson(topic: string, prompt: string): GeneratedLesson {
  return {
    lessonTitle: `Understanding ${topic}`,
    lessonSummary: `${topic} explained in a simple and engaging way.`,
    lessonBody: `
${topic} is a fascinating concept.

Prompt: ${prompt}

Step 1:
We start by understanding the basics of ${topic}.

Step 2:
We explore how ${topic} affects real-world systems.

Step 3:
We connect ${topic} to a deeper insight that makes you say "wow".
    `,
    wowFacts: [
      `${topic} can behave differently depending on context.`,
      `${topic} often connects multiple disciplines together.`,
      `${topic} changes how we perceive reality in subtle ways.`,
    ],
    quizQuestions: [
      {
        type: "mcq",
        question: `What is a key idea behind ${topic}?`,
        options: [
          "It has no real-world effect",
          "It is purely theoretical",
          "It influences real systems",
          "It is random",
        ],
        answer: "It influences real systems",
      },
    ],
  };
}
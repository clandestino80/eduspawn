import { z } from "zod";

/** Short-form creator pack (free / lightweight path). */
export const shortCreatorPackSchema = z.object({
  title: z.string().min(1).max(200),
  hook: z.string().min(1).max(500),
  shortIntro: z.string().min(1).max(800),
  shortScript: z.string().min(1).max(4000),
  titleSequenceText: z.string().min(1).max(400),
  voiceoverText: z.string().min(1).max(4000),
  visualCue: z.string().min(1).max(2000),
});

export type ShortCreatorPack = z.infer<typeof shortCreatorPackSchema>;

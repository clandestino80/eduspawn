import { z } from "zod";

const sceneOutlineItemSchema = z.object({
  sceneNumber: z.number().int().min(1).max(200),
  beat: z.string().min(1).max(800),
});

/** Long-form creator pack (pro / premium orchestration). */
export const longCreatorPackSchema = z
  .object({
    projectTitle: z.string().min(1).max(200),
    positioningLine: z.string().min(1).max(400),
    titleSequencePack: z.string().min(1).max(1200),
    hookVariants: z.array(z.string().min(1).max(400)).min(1).max(12),
    masterSynopsis: z.string().min(1).max(8000),
    sceneOutline: z.array(sceneOutlineItemSchema).min(1).max(80),
    sceneNarration: z.array(z.string().min(1).max(2000)).min(1).max(80),
    voiceoverScript: z.string().min(1).max(20000),
    visualPromptPack: z.string().min(1).max(8000),
    musicMood: z.string().min(1).max(400),
    endingCTA: z.string().min(1).max(800),
    productionNotes: z.string().min(1).max(4000),
  })
  .superRefine((val, ctx) => {
    if (val.sceneNarration.length !== val.sceneOutline.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sceneNarration must have the same length as sceneOutline",
        path: ["sceneNarration"],
      });
    }
  });

export type LongCreatorPack = z.infer<typeof longCreatorPackSchema>;

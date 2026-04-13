import type { CreatorPackKind } from "@prisma/client";

const MAX_PROMPT_LEN = 2500;

/** Turn creator-pack script JSON into a single prompt string for Kling text-to-video. */
export function buildKlingTextPrompt(script: Record<string, unknown>, packKind: CreatorPackKind): string {
  const parts: string[] = [];
  if (packKind === "SHORT_FORM") {
    const title = pickString(script, "title");
    const hook = pickString(script, "hook");
    const intro = pickString(script, "shortIntro");
    const body = pickString(script, "shortScript");
    const vo = pickString(script, "voiceoverText");
    const visual = pickString(script, "visualCue");
    if (title) parts.push(`Title: ${title}`);
    if (hook) parts.push(`Hook: ${hook}`);
    if (intro) parts.push(`Intro: ${intro}`);
    if (body) parts.push(`Script: ${body}`);
    if (vo) parts.push(`Voiceover: ${vo}`);
    if (visual) parts.push(`Visual direction: ${visual}`);
  } else {
    const title = pickString(script, "projectTitle");
    const pos = pickString(script, "positioningLine");
    const syn = pickString(script, "masterSynopsis");
    const vo = pickString(script, "voiceoverScript");
    const visual = pickString(script, "visualPromptPack");
    const cta = pickString(script, "endingCTA");
    if (title) parts.push(`Project: ${title}`);
    if (pos) parts.push(`Positioning: ${pos}`);
    if (syn) parts.push(`Synopsis: ${syn}`);
    if (vo) parts.push(`Voiceover script: ${vo}`);
    if (visual) parts.push(`Visual prompts: ${visual}`);
    if (cta) parts.push(`Ending CTA: ${cta}`);
  }
  const raw = parts.length > 0 ? parts.join("\n\n") : JSON.stringify(script).slice(0, MAX_PROMPT_LEN);
  return raw.length > MAX_PROMPT_LEN ? `${raw.slice(0, MAX_PROMPT_LEN - 1)}…` : raw;
}

function pickString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v === "string") return v.trim();
  return "";
}

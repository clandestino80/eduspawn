import { createHash } from "node:crypto";

export type CreatorMemoryKeyFacets = {
  topicNorm: string;
  curiosityNorm: string;
  durationBand: string;
  targetPlatform: string;
  presetKey: string;
  languageNorm: string;
  toneNorm: string;
  goal: string;
  packKind: "SHORT_FORM" | "LONG_FORM";
};

export function normalizeFacetText(value: string, maxChars: number): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export function buildCreatorMemoryKeyFacets(input: {
  topic: string;
  curiosityPrompt: string;
  durationBand: string;
  targetPlatform: string;
  presetKey?: string | undefined;
  language: string;
  tone: string;
  goal: string;
  packKind: "SHORT_FORM" | "LONG_FORM";
}): CreatorMemoryKeyFacets {
  const preset = normalizeFacetText(input.presetKey ?? "", 80);
  return {
    topicNorm: normalizeFacetText(input.topic, 400),
    curiosityNorm: normalizeFacetText(input.curiosityPrompt, 400),
    durationBand: input.durationBand,
    targetPlatform: input.targetPlatform,
    presetKey: preset.length > 0 ? preset : "(none)",
    languageNorm: normalizeFacetText(input.language, 64),
    toneNorm: normalizeFacetText(input.tone, 120),
    goal: input.goal,
    packKind: input.packKind,
  };
}

/**
 * Deterministic lookup key from facets (topic alone is insufficient).
 */
export function buildCreatorLookupKey(facets: CreatorMemoryKeyFacets): string {
  const keys = Object.keys(facets).sort() as (keyof CreatorMemoryKeyFacets)[];
  const sorted: Record<string, string> = {};
  for (const k of keys) {
    sorted[k] = facets[k];
  }
  const canonical = JSON.stringify(sorted);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

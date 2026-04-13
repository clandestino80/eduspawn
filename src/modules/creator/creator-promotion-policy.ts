/**
 * Low-risk eligibility for promoting a **system-generated original** pack into global creator memory.
 * User-edited private variants must never pass through here by default.
 */
export function isEligibleForDefaultGlobalPromotion(args: {
  originalPack: unknown;
}): boolean {
  const p = args.originalPack;
  if (!p || typeof p !== "object") return false;
  const raw = JSON.stringify(p);
  if (raw.length < 80) return false;
  // Obvious personal direct-contact patterns — not a full moderation pipeline.
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(raw)) return false;
  if (/\b\+?\d[\d\s().-]{8,}\b/.test(raw) && /\b(call|text|dm|whatsapp)\b/i.test(raw)) {
    return false;
  }
  const o = p as Record<string, unknown>;
  const title =
    typeof o.title === "string"
      ? o.title.trim()
      : typeof o.projectTitle === "string"
        ? o.projectTitle.trim()
        : "";
  if (title.length < 4) return false;
  return true;
}

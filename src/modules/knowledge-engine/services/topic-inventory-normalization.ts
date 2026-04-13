import { createHash } from "node:crypto";

const MAX_RAW_NORMALIZED_KEY = 480;

/**
 * Stable dedupe key for `GlobalTopicInventory.normalizedKey` (matches promotion + bootstrap).
 * Long inputs hash to a fixed-length `h:<sha256>` so DB row stays bounded.
 */
export function buildGlobalTopicNormalizedKey(input: {
  domain: string;
  subdomain: string;
  title: string;
  curiosityHook?: string | null;
}): string {
  const dm = input.domain.trim().toLowerCase();
  const sm = input.subdomain.trim().toLowerCase();
  const tt = input.title.trim().toLowerCase().replace(/\s+/g, " ");
  const cq = (input.curiosityHook ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const raw = [dm, sm, tt, cq].join("\x1f");
  if (raw.length <= MAX_RAW_NORMALIZED_KEY) {
    return raw;
  }
  return `h:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

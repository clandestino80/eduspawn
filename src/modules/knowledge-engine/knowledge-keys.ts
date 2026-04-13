import { createHash } from "node:crypto";

/**
 * Stable category bucket key for a user (must match Slice A persistence).
 * `topic` and `curiosity` should already be trimmed by callers when mirroring persist behavior.
 */
export function buildCategoryNormalizedKeyV1(topic: string, curiosity: string): string {
  const payload = `${topic}\n${curiosity}`;
  const hash = createHash("sha256").update(payload, "utf8").digest("hex");
  return `v1:tc:${hash}`;
}

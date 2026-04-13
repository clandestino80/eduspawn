/**
 * Paths aligned with Kling AI public HTTP API as documented at https://klingapi.com/docs
 * (text-to-video submission + task status polling).
 */
export const KLING_OFFICIAL_API_BASE = "https://api.klingapi.com";

export const KLING_TEXT2VIDEO_PATH = "/v1/videos/text2video";

export function klingVideoTaskPath(taskId: string): string {
  return `/v1/videos/${encodeURIComponent(taskId)}`;
}

import type { ParsedProviderWebhook } from "../../render-provider.types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readNestedTask(obj: Record<string, unknown>): Record<string, unknown> | null {
  const data = obj.data;
  if (isRecord(data)) return data;
  const payload = obj.payload;
  if (isRecord(payload)) return payload;
  return null;
}

function readTaskId(obj: Record<string, unknown>): string | null {
  if (typeof obj.task_id === "string" && obj.task_id.trim()) return obj.task_id.trim();
  if (typeof obj.taskId === "string" && obj.taskId.trim()) return obj.taskId.trim();
  const nested = readNestedTask(obj);
  if (nested) {
    if (typeof nested.task_id === "string" && nested.task_id.trim()) return nested.task_id.trim();
    if (typeof nested.taskId === "string" && nested.taskId.trim()) return nested.taskId.trim();
  }
  return null;
}

function readStatus(obj: Record<string, unknown>): string | null {
  if (typeof obj.status === "string") return obj.status;
  const nested = readNestedTask(obj);
  if (nested && typeof nested.status === "string") return nested.status;
  return null;
}

function readUrlFields(obj: Record<string, unknown>): { outputUrl?: string; thumbnailUrl?: string } {
  const out: { outputUrl?: string; thumbnailUrl?: string } = {};
  const tryPick = (root: Record<string, unknown>) => {
    const video = root.video;
    if (isRecord(video) && typeof video.url === "string" && /^https?:\/\//i.test(video.url)) {
      out.outputUrl = video.url;
    }
    for (const k of ["video_url", "videoUrl", "output_url", "outputUrl", "url"]) {
      const v = root[k];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) {
        out.outputUrl = v;
        break;
      }
    }
    for (const k of ["thumbnail_url", "thumbnailUrl", "cover_url", "poster_url"]) {
      const v = root[k];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) {
        out.thumbnailUrl = v;
        break;
      }
    }
  };
  tryPick(obj);
  const nested = readNestedTask(obj);
  if (nested) tryPick(nested);
  return out;
}

function readFailure(obj: Record<string, unknown>): string | undefined {
  for (const k of ["error", "error_message", "errorMessage", "message", "failure_reason", "failureReason"]) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const nested = readNestedTask(obj);
  if (nested) {
    for (const k of ["error", "error_message", "errorMessage", "message"]) {
      const v = nested[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return undefined;
}

function mapStatus(raw: string): ParsedProviderWebhook["status"] | null {
  const s = raw.toLowerCase().replace(/\s+/g, "_");
  if (
    s === "completed" ||
    s === "complete" ||
    s === "succeeded" ||
    s === "success" ||
    s === "done" ||
    s === "finished"
  ) {
    return "SUCCEEDED";
  }
  if (s === "failed" || s === "error" || s === "cancelled" || s === "canceled") {
    return "FAILED";
  }
  if (
    s === "processing" ||
    s === "generating" ||
    s === "running" ||
    s === "in_progress" ||
    s === "queued" ||
    s === "pending" ||
    s === "submitted" ||
    s === "waiting"
  ) {
    return "PROCESSING";
  }
  return null;
}

/**
 * Best-effort parse of vendor POST bodies that may hit our callback URL.
 *
 * Public Kling API docs at https://klingapi.com/docs describe task creation and polling;
 * they do not publish a strict callback JSON schema here. This parser accepts common
 * `{ task_id, status, video: { url } }` shapes and nested `data` objects.
 */
export function parseKlingProviderCallback(raw: unknown): ParsedProviderWebhook | null {
  if (!isRecord(raw)) return null;
  const taskId = readTaskId(raw);
  if (!taskId) return null;
  const statusRaw = readStatus(raw);
  if (!statusRaw) return null;
  const mapped = mapStatus(statusRaw);
  if (!mapped) return null;
  const urls = readUrlFields(raw);
  return {
    provider: "KLING",
    providerJobId: taskId,
    status: mapped,
    outputUrl: urls.outputUrl,
    thumbnailUrl: urls.thumbnailUrl,
    failureReason: mapped === "FAILED" ? readFailure(raw) ?? `Kling status: ${statusRaw}` : undefined,
  };
}

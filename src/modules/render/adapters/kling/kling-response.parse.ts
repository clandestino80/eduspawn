import type { RenderStatusOk } from "../../render-provider.types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Extract `task_id` from POST /v1/videos/text2video success JSON (official quickstart uses root `task_id`). */
export function extractKlingSubmitTaskId(json: unknown): string | null {
  if (!isRecord(json)) return null;
  if (typeof json.task_id === "string" && json.task_id.trim()) return json.task_id.trim();
  if (typeof json.taskId === "string" && json.taskId.trim()) return json.taskId.trim();
  const data = json.data;
  if (isRecord(data)) {
    if (typeof data.task_id === "string" && data.task_id.trim()) return data.task_id.trim();
    if (typeof data.taskId === "string" && data.taskId.trim()) return data.taskId.trim();
  }
  return null;
}

function pickUrl(obj: Record<string, unknown>): string | undefined {
  const candidates = ["url", "video_url", "videoUrl", "output_url", "outputUrl"];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  const video = obj.video;
  if (isRecord(video) && typeof video.url === "string" && /^https?:\/\//i.test(video.url)) {
    return video.url;
  }
  const result = obj.result;
  if (isRecord(result)) {
    for (const k of candidates) {
      const v = result[k];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }
    const rv = result.video;
    if (isRecord(rv) && typeof rv.url === "string" && /^https?:\/\//i.test(rv.url)) return rv.url;
  }
  return undefined;
}

function pickThumb(obj: Record<string, unknown>): string | undefined {
  const keys = ["thumbnail_url", "thumbnailUrl", "cover_url", "coverUrl", "poster_url", "posterUrl"];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  return undefined;
}

function pickFailure(obj: Record<string, unknown>): string | undefined {
  const keys = ["error", "error_message", "errorMessage", "message", "detail", "failure_reason", "failureReason"];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const err = obj.error;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  return undefined;
}

function pickStatusString(json: unknown): string | null {
  if (!isRecord(json)) return null;
  if (typeof json.status === "string") return json.status;
  const data = json.data;
  if (isRecord(data) && typeof data.status === "string") return data.status;
  return null;
}

/** Map vendor status strings to internal poll result (GET /v1/videos/{task_id}). */
export function mapKlingPollToRenderStatus(json: unknown): RenderStatusOk {
  const raw = pickStatusString(json) ?? "processing";
  const s = raw.toLowerCase().replace(/\s+/g, "_");

  if (
    s === "completed" ||
    s === "complete" ||
    s === "succeeded" ||
    s === "success" ||
    s === "done" ||
    s === "finished"
  ) {
    const obj = isRecord(json) ? json : {};
    const url = pickUrl(obj);
    const thumb = pickThumb(obj);
    const result: RenderStatusOk = {
      ok: true,
      status: "SUCCEEDED",
      metadataJson: { klingStatus: raw, poll: true },
    };
    if (url !== undefined) {
      result.outputUrl = url;
    }
    if (thumb !== undefined) {
      result.thumbnailUrl = thumb;
    }
    return result;
  }

  if (s === "failed" || s === "error" || s === "cancelled" || s === "canceled") {
    const obj = isRecord(json) ? json : {};
    return {
      ok: true,
      status: "FAILED",
      failureReason: pickFailure(obj) ?? `Kling task status: ${raw}`,
      metadataJson: { klingStatus: raw, poll: true },
    };
  }

  return {
    ok: true,
    status: "PROCESSING",
    metadataJson: { klingStatus: raw, poll: true },
  };
}

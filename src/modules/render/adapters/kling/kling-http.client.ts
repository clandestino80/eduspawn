import { getEnv } from "../../../../config/env";
import { KLING_OFFICIAL_API_BASE } from "./kling-api.constants";
import type { KlingHttpResult } from "./kling-http.types";

export type KlingHttpDeps = {
  fetchImpl?: typeof fetch;
};

function resolveBaseUrl(): string {
  const env = getEnv();
  const configured = env.RENDER_KLING_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return KLING_OFFICIAL_API_BASE.replace(/\/+$/, "");
}

/**
 * Low-level JSON HTTP call to the configured Kling API base.
 * Auth: `Authorization: Bearer <RENDER_KLING_API_KEY>` per https://klingapi.com/docs
 */
export async function klingHttpJson(
  deps: KlingHttpDeps | undefined,
  args: { method: "GET" | "POST"; path: string; body?: unknown },
): Promise<KlingHttpResult> {
  const env = getEnv();
  const key = env.RENDER_KLING_API_KEY?.trim();
  if (!key) {
    return { ok: false, status: 0, message: "RENDER_KLING_API_KEY is not set", errorCode: "KLING_NOT_CONFIGURED" };
  }

  const base = resolveBaseUrl();
  const url = `${base}${args.path.startsWith("/") ? args.path : `/${args.path}`}`;
  const fetchFn = deps?.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  let bodyStr: string | undefined;
  if (args.method === "POST") {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(args.body ?? {});
  }

  let res: Response;
  try {
    const requestInit: RequestInit = {
      method: args.method,
      headers,
    };
    if (bodyStr !== undefined) {
      requestInit.body = bodyStr;
    }
    res = await fetchFn(url, requestInit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error calling Kling API";
    return { ok: false, status: 0, message: msg, errorCode: "KLING_NETWORK_ERROR" };
  }

  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return {
        ok: false,
        status: res.status,
        message: `Kling API returned non-JSON (${res.status})`,
        errorCode: "KLING_INVALID_RESPONSE",
        rawBody: text.slice(0, 2000),
      };
    }
  }

  if (!res.ok) {
    const msg = extractErrorMessage(json) || `Kling API request failed (${res.status})`;
    return {
      ok: false,
      status: res.status,
      message: msg,
      errorCode: res.status === 401 || res.status === 403 ? "KLING_AUTH_ERROR" : "KLING_HTTP_ERROR",
      json,
    };
  }

  return { ok: true, status: res.status, json };
}

function extractErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.message === "string") return o.message;
  const err = o.error;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  if (typeof o.detail === "string") return o.detail;
  return null;
}

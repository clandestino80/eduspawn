/**
 * Deterministic, bounded normalization for Slice C lesson knowledge extraction.
 * Produces payloads suitable for strict Zod validation; does not persist.
 */

import { unwrapMarkdownJson } from "../../ai/providers/provider-shared";

export type UnwrapExtractionContentResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      code:
        | "empty"
        | "malformed_json_string"
        | "unexpected_type"
        | "parsed_non_object";
      preview?: string;
      detail?: string;
    };

export type NormalizedExtractionPayload = {
  concepts: Array<{
    title: string;
    summary?: string;
    kind?: string;
    confidence?: number;
  }>;
};

function safePreview(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

const MAX_JSON_STRING_PEEL_DEPTH = 5;

/**
 * Unwrap provider `content`:
 * - Already an object/array (typical OpenAI json_object parsed path) → pass through.
 * - String: strip markdown fences, JSON.parse, and repeat while the result is still a string
 *   (double-encoded JSON is common: outer quotes yield a string that is itself JSON text).
 */
export function unwrapExtractionContent(raw: unknown): UnwrapExtractionContentResult {
  if (raw === null || raw === undefined) {
    return { ok: false, code: "empty" };
  }

  if (typeof raw === "object") {
    return { ok: true, value: raw };
  }

  if (typeof raw === "string") {
    let cur: unknown = raw;
    for (let depth = 0; depth < MAX_JSON_STRING_PEEL_DEPTH; depth++) {
      if (typeof cur !== "string") {
        break;
      }
      const stripped = unwrapMarkdownJson(cur);
      if (!stripped.length) {
        return { ok: false, code: "empty" };
      }
      try {
        cur = JSON.parse(stripped) as unknown;
      } catch {
        return {
          ok: false,
          code: "malformed_json_string",
          preview: safePreview(stripped, 240),
        };
      }
    }

    if (cur === null || cur === undefined) {
      return { ok: false, code: "empty" };
    }
    if (typeof cur !== "object") {
      return {
        ok: false,
        code: "unexpected_type",
        detail: typeof cur,
      };
    }
    return { ok: true, value: cur };
  }

  return { ok: false, code: "unexpected_type", detail: typeof raw };
}

function coerceConfidence(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) {
      return value;
    }
    return undefined;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t.length) {
      return undefined;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) {
      return undefined;
    }
    if (n < 0 || n > 1) {
      return undefined;
    }
    return n;
  }
  return undefined;
}

const MAX_TITLE = 180;
const MAX_SUMMARY = 420;
const MAX_KIND = 64;

/**
 * Keep only schema-allowed keys; trim; coerce confidence; enforce length bounds.
 */
function stripConceptItem(raw: unknown): NormalizedExtractionPayload["concepts"][number] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const o = raw as Record<string, unknown>;
  let title: string;
  if (typeof o.title === "string") {
    title = o.title.replace(/\s+/g, " ").trim();
  } else if (typeof o.title === "number" && Number.isFinite(o.title)) {
    title = String(o.title).replace(/\s+/g, " ").trim();
  } else {
    return null;
  }

  if (!title.length) {
    return null;
  }
  if (title.length > MAX_TITLE) {
    title = title.slice(0, MAX_TITLE);
  }

  let summary: string | undefined;
  if (typeof o.summary === "string") {
    const s = o.summary.replace(/\s+/g, " ").trim();
    if (s.length > 0) {
      summary = s.length > MAX_SUMMARY ? s.slice(0, MAX_SUMMARY) : s;
    }
  }

  let kind: string | undefined;
  if (typeof o.kind === "string") {
    const k = o.kind.replace(/\s+/g, " ").trim();
    if (k.length > 0) {
      kind = k.length > MAX_KIND ? k.slice(0, MAX_KIND) : k;
    }
  }

  const confidence = coerceConfidence(o.confidence);

  const out: NormalizedExtractionPayload["concepts"][number] = { title };
  if (summary !== undefined) {
    out.summary = summary;
  }
  if (kind !== undefined) {
    out.kind = kind;
  }
  if (confidence !== undefined) {
    out.confidence = confidence;
  }
  return out;
}

/**
 * Build a strict-schema-shaped object from common near-misses:
 * - top-level array of concept-like objects → { concepts }
 * - { concepts } or { Concepts } with extra keys stripped per item
 */
export function normalizeLessonExtractionPayload(data: unknown): NormalizedExtractionPayload | null {
  let rows: unknown[] | null = null;

  if (Array.isArray(data)) {
    rows = data;
  } else if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.concepts)) {
      rows = o.concepts;
    } else if (Array.isArray(o.Concepts)) {
      rows = o.Concepts;
    }
  }

  if (!rows || rows.length === 0) {
    return null;
  }

  const concepts: NormalizedExtractionPayload["concepts"] = [];
  for (const item of rows) {
    const s = stripConceptItem(item);
    if (s) {
      concepts.push(s);
    }
    if (concepts.length >= 6) {
      break;
    }
  }

  if (concepts.length === 0) {
    return null;
  }

  return { concepts };
}

/**
 * Compact, safe summary for logs (no full lesson body).
 */
export function summarizeExtractionPayloadForLog(value: unknown, maxLen = 480): string {
  try {
    const summary = summarizeValue(value, 2);
    const s = JSON.stringify(summary);
    return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
  } catch {
    return safePreview(String(value), maxLen);
  }
}

function summarizeValue(v: unknown, depth: number): unknown {
  if (depth <= 0) {
    return "…";
  }
  if (v === null) {
    return null;
  }
  if (Array.isArray(v)) {
    const first = v[0];
    return {
      type: "array",
      length: v.length,
      first:
        first !== undefined && typeof first === "object" && first !== null && !Array.isArray(first)
          ? { keys: Object.keys(first as object).slice(0, 14) }
          : summarizeValue(first, depth - 1),
    };
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    const out: Record<string, unknown> = { _type: "object", keys: keys.slice(0, 14) };
    if (Array.isArray(o.concepts)) {
      out.conceptsLength = o.concepts.length;
      const c0 = o.concepts[0];
      if (c0 !== undefined && typeof c0 === "object" && c0 !== null && !Array.isArray(c0)) {
        out.concept0Keys = Object.keys(c0 as object).slice(0, 14);
      }
    }
    if (Array.isArray(o.Concepts)) {
      out.ConceptsLength = o.Concepts.length;
    }
    return out;
  }
  if (typeof v === "string") {
    return { type: "string", length: v.length, head: v.slice(0, 100) };
  }
  return { type: typeof v };
}

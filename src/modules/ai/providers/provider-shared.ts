import { AiProviderResponseError } from "./ai-provider.errors";
import type {
  AiGenerationInput,
  AiMessage,
  AiGenerationOutput,
  ModelRouteDecision,
} from "./ai-provider.types";

const JSON_MODE_HINT =
  "Return a single valid JSON object only. Do not wrap the JSON in markdown code fences or add commentary outside the JSON.";

export const PROVIDER_FETCH_TIMEOUT_MS = 180_000;

function clampTemperature(value: number): number {
  return Math.max(0, Math.min(2, value));
}

export function resolveEffectiveMaxTokens(
  input: AiGenerationInput,
  route: ModelRouteDecision,
): number {
  const cap = Math.max(1, Math.floor(route.maxTokens));
  const fromInput = input.maxTokens;

  if (fromInput !== undefined && Number.isFinite(fromInput) && fromInput > 0) {
    return Math.min(Math.floor(fromInput), cap);
  }

  return cap;
}

export function resolveEffectiveTemperature(
  input: AiGenerationInput,
  route: ModelRouteDecision,
): number {
  const fromInput = input.temperature;

  if (fromInput !== undefined && Number.isFinite(fromInput)) {
    return clampTemperature(fromInput);
  }

  return clampTemperature(route.temperature);
}

/** When providers need explicit JSON instruction (esp. OpenAI json_object). */
export function augmentMessagesForJsonMode(messages: AiMessage[]): AiMessage[] {
  const firstSystemIdx = messages.findIndex((m) => m.role === "system");

  if (firstSystemIdx >= 0) {
    const copy = [...messages];
    const existing = copy[firstSystemIdx];

    if (existing) {
      const alreadyHasHint = existing.content.includes(JSON_MODE_HINT);

      copy[firstSystemIdx] = {
        role: "system",
        content: alreadyHasHint
          ? existing.content
          : `${existing.content}\n\n${JSON_MODE_HINT}`,
      };
    }

    return copy;
  }

  return [{ role: "system", content: JSON_MODE_HINT }, ...messages];
}

export function unwrapMarkdownJson(text: string): string {
  const trimmed = text.trim();

  if (!trimmed) {
    return "";
  }

  const exactFenceMatch = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(trimmed);
  if (exactFenceMatch?.[1]) {
    return exactFenceMatch[1].trim();
  }

  const firstFenceMatch = /```(?:json)?\s*([\s\S]*?)```/im.exec(trimmed);
  if (firstFenceMatch?.[1]) {
    return firstFenceMatch[1].trim();
  }

  return trimmed;
}

/** Parse JSON mode text into object when possible; otherwise return trimmed string. */
export function normalizeJsonModeContent(text: string): unknown {
  const trimmed = unwrapMarkdownJson(text);

  if (!trimmed) {
    return "";
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

export function assertNonEmptyContent(
  value: unknown,
  provider: AiGenerationOutput["provider"],
): void {
  if (value === null || value === undefined) {
    throw new AiProviderResponseError(
      provider,
      "EMPTY_RESPONSE",
      "Model returned empty content.",
    );
  }

  if (typeof value === "string" && value.trim().length === 0) {
    throw new AiProviderResponseError(
      provider,
      "EMPTY_RESPONSE",
      "Model returned empty text content.",
    );
  }
}

export async function readResponseBody(res: Response): Promise<unknown> {
  const text = await res.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createAbortHandle(
  ms: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  if (typeof (timer as NodeJS.Timeout).unref === "function") {
    (timer as NodeJS.Timeout).unref();
  }

  const cancel = (): void => {
    clearTimeout(timer);
  };

  return {
    signal: controller.signal,
    cancel,
  };
}
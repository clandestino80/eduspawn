import {
  AiProviderConfigurationError,
  AiProviderHttpError,
} from "./ai-provider.errors";
import type {
  AiGenerationInput,
  AiGenerationOutput,
  AiMessage,
  AiProvider,
  ModelRouteDecision,
} from "./ai-provider.types";
import {
  augmentMessagesForJsonMode,
  assertNonEmptyContent,
  createAbortHandle,
  normalizeJsonModeContent,
  PROVIDER_FETCH_TIMEOUT_MS,
  readResponseBody,
  resolveEffectiveMaxTokens,
  resolveEffectiveTemperature,
} from "./provider-shared";

type GeminiPart = {
  text?: string;
};

type GeminiContent = {
  role?: "user" | "model";
  parts?: GeminiPart[];
};

type GeminiCandidate = {
  finishReason?: string;
  content?: {
    parts?: GeminiPart[];
  };
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type CostRates = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

const MODEL_COSTS: Readonly<Record<string, CostRates>> = {
  "gemini-2.5-flash": {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
  },
  "gemini-2.5-pro": {
    inputPerMillion: 1.25,
    outputPerMillion: 10,
  },
  "gemini-1.5-flash": {
    inputPerMillion: 0.35,
    outputPerMillion: 1.05,
  },
  "gemini-1.5-pro": {
    inputPerMillion: 1.25,
    outputPerMillion: 5,
  },
};

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function getGeminiBaseUrl(): string {
  return (readEnv("GEMINI_BASE_URL") ?? DEFAULT_GEMINI_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

function normalizeMessageContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function mapGeminiFinishReason(
  raw: string | null | undefined,
): AiGenerationOutput["finishReason"] {
  const normalized = (raw ?? "").toUpperCase();

  if (
    normalized === "STOP" ||
    normalized === "FINISH_REASON_UNSPECIFIED" ||
    normalized === ""
  ) {
    return "stop";
  }

  if (normalized === "MAX_TOKENS") {
    return "length";
  }

  if (normalized.includes("TOOL")) {
    return "tool_use";
  }

  return "unknown";
}

function buildGeminiContents(messages: AiMessage[]): {
  systemInstruction?: { parts: GeminiPart[] };
  contents: GeminiContent[];
} {
  const systemParts: string[] = [];
  const turns: AiMessage[] = [];

  for (const message of messages) {
    const normalized = normalizeMessageContent(message.content);

    if (!normalized) {
      continue;
    }

    if (message.role === "system") {
      systemParts.push(normalized);
      continue;
    }

    if (message.role === "user" || message.role === "assistant") {
      turns.push({
        ...message,
        content: normalized,
      });
    }
  }

  const contents: GeminiContent[] = [];

  for (const message of turns) {
    const geminiRole: "user" | "model" =
      message.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];

    if (last && last.role === geminiRole) {
      const parts = last.parts ?? [];
      parts.push({ text: message.content });
      last.parts = parts;
    } else {
      contents.push({
        role: geminiRole,
        parts: [{ text: message.content }],
      });
    }
  }

  if (contents.length > 0 && contents[0]?.role === "model") {
    contents.unshift({
      role: "user",
      parts: [{ text: "Continue from the prior model context." }],
    });
  }

  const result: {
    systemInstruction?: { parts: GeminiPart[] };
    contents: GeminiContent[];
  } = {
    contents,
  };

  if (systemParts.length > 0) {
    result.systemInstruction = {
      parts: [{ text: systemParts.join("\n\n") }],
    };
  }

  return result;
}

function resolveGeminiCostRates(model: string): CostRates | undefined {
  const normalized = model.trim();

  if (!normalized) {
    return undefined;
  }

  if (MODEL_COSTS[normalized]) {
    return MODEL_COSTS[normalized];
  }

  const matchedKey = Object.keys(MODEL_COSTS)
    .sort((a, b) => b.length - a.length)
    .find((key) => normalized.startsWith(key));

  return matchedKey ? MODEL_COSTS[matchedKey] : undefined;
}

function estimateGeminiCostUsd(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number | undefined {
  const promptTokens = Math.max(0, params.promptTokens);
  const completionTokens = Math.max(0, params.completionTokens);

  if (promptTokens === 0 && completionTokens === 0) {
    return 0;
  }

  const rates = resolveGeminiCostRates(params.model);

  if (!rates) {
    return undefined;
  }

  const estimatedUsd =
    (promptTokens / 1_000_000) * rates.inputPerMillion +
    (completionTokens / 1_000_000) * rates.outputPerMillion;

  return Number(estimatedUsd.toFixed(6));
}

function extractGeminiErrorMessage(
  payload: GeminiResponse | string | null,
  fallback: string,
): string {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed || fallback;
  }

  if (payload?.error?.message) {
    return payload.error.message;
  }

  if (payload?.promptFeedback?.blockReason) {
    return `Prompt blocked: ${payload.promptFeedback.blockReason}`;
  }

  return fallback;
}

function extractGeminiText(candidate: GeminiCandidate | undefined): string {
  const parts = candidate?.content?.parts ?? [];

  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;

  async generate(
    input: AiGenerationInput,
    route: ModelRouteDecision,
  ): Promise<AiGenerationOutput> {
    const apiKey = readEnv("GEMINI_API_KEY");

    if (!apiKey) {
      throw new AiProviderConfigurationError(
        this.name,
        "Gemini is not configured: set GEMINI_API_KEY in the environment.",
      );
    }

    const responseFormat = route.responseFormat;
    const effectiveTemperature = resolveEffectiveTemperature(input, route);
    const effectiveMaxTokens = Math.max(
      1,
      resolveEffectiveMaxTokens(input, route),
    );

    const sourceMessages =
      responseFormat === "json"
        ? augmentMessagesForJsonMode(input.messages)
        : input.messages;

    const { systemInstruction, contents } = buildGeminiContents(sourceMessages);

    if (contents.length === 0) {
      throw new AiProviderHttpError(
        this.name,
        400,
        "Gemini requires at least one user or assistant message.",
        {
          request: {
            provider: this.name,
            endpoint: `${getGeminiBaseUrl()}/models/${route.model}:generateContent`,
            model: route.model,
            taskType: input.taskType,
            planTier: input.planTier,
            responseFormat,
            messageCount: sourceMessages.length,
          },
        },
      );
    }

    const generationConfig: Record<string, unknown> = {
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
    };

    if (responseFormat === "json") {
      generationConfig.responseMimeType = "application/json";
    }

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    const requestSummary = {
      provider: this.name,
      endpoint: `${getGeminiBaseUrl()}/models/${route.model}:generateContent`,
      model: route.model,
      taskType: input.taskType,
      planTier: input.planTier,
      responseFormat,
      messageCount: sourceMessages.length,
      conversationCount: contents.length,
      hasSystemInstruction: Boolean(systemInstruction),
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      jsonMode: responseFormat === "json",
      metadata: input.metadata ?? null,
    };

    const model = encodeURIComponent(route.model);
    const url = `${getGeminiBaseUrl()}/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey,
    )}`;

    const { signal, cancel } = createAbortHandle(PROVIDER_FETCH_TIMEOUT_MS);
    const started = Date.now();

    let res: Response;

    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (err) {
      cancel();

      if (err instanceof Error && err.name === "AbortError") {
        throw new AiProviderHttpError(
          this.name,
          408,
          "Gemini request timed out.",
          {
            reason: "timeout",
            timeoutMs: PROVIDER_FETCH_TIMEOUT_MS,
            request: requestSummary,
          },
        );
      }

      throw new AiProviderHttpError(
        this.name,
        0,
        `Gemini network error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        {
          cause: String(err),
          request: requestSummary,
        },
      );
    } finally {
      cancel();
    }

    const latencyMs = Date.now() - started;

    const payload = (await readResponseBody(res)) as
      | GeminiResponse
      | string
      | null;

    if (!res.ok) {
      const message = extractGeminiErrorMessage(payload, res.statusText);

      throw new AiProviderHttpError(
        this.name,
        res.status,
        `Gemini API error: ${message}`,
        {
          request: requestSummary,
          response: payload,
        },
      );
    }

    if (typeof payload !== "object" || payload === null) {
      throw new AiProviderHttpError(
        this.name,
        res.status,
        "Gemini returned an unexpected response body.",
        {
          request: requestSummary,
          response: payload,
        },
      );
    }

    const candidate = payload.candidates?.[0];
    const text = extractGeminiText(candidate);

    if (!text && payload.promptFeedback?.blockReason) {
      throw new AiProviderHttpError(
        this.name,
        422,
        `Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`,
        {
          blockReason: payload.promptFeedback.blockReason,
          request: requestSummary,
          response: payload,
        },
      );
    }

    if (!text && candidate?.finishReason) {
      throw new AiProviderHttpError(
        this.name,
        422,
        `Gemini returned no text (finishReason=${candidate.finishReason}).`,
        {
          finishReason: candidate.finishReason,
          request: requestSummary,
          response: payload,
        },
      );
    }

    const content: unknown =
      responseFormat === "json"
        ? normalizeJsonModeContent(text)
        : text;

    assertNonEmptyContent(content, this.name);

    const usage = payload.usageMetadata ?? {};
    const promptTokens = Math.max(
      0,
      Math.floor(usage.promptTokenCount ?? 0),
    );
    const completionTokens = Math.max(
      0,
      Math.floor(usage.candidatesTokenCount ?? 0),
    );
    const totalTokens = Math.max(
      0,
      Math.floor(usage.totalTokenCount ?? promptTokens + completionTokens),
    );

    const resolvedModel = payload.modelVersion ?? route.model;
    const costEstimate = estimateGeminiCostUsd({
      model: resolvedModel,
      promptTokens,
      completionTokens,
    });

    const output: AiGenerationOutput = {
  provider: this.name,
  model: resolvedModel,
  content,
  usage: {
    promptTokens,
    completionTokens,
    totalTokens,
  },
  latencyMs,
  finishReason: mapGeminiFinishReason(candidate?.finishReason),
  raw: {
    request: requestSummary,
    json_mode: responseFormat === "json",
    estimated_cost_usd: costEstimate,
    model_version: payload.modelVersion,
    finishReason: candidate?.finishReason,
    promptFeedback: payload.promptFeedback ?? null,
    response: payload,
  },
};

if (costEstimate !== undefined) {
  output.costEstimate = costEstimate;
}

return output;
  }
}
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
  role?: string;
  parts?: GeminiPart[];
};

type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

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
    if (message.role === "system") {
      systemParts.push(message.content);
    } else {
      turns.push(message);
    }
  }

  const contents: GeminiContent[] = [];

  for (const message of turns) {
    const geminiRole = message.role === "assistant" ? "model" : "user";
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
    contents: GeminiContent[];
    systemInstruction?: { parts: GeminiPart[] };
  } = { contents };

  if (systemParts.length > 0) {
    result.systemInstruction = {
      parts: [{ text: systemParts.join("\n\n") }],
    };
  }

  return result;
}

function estimateGeminiCostUsd(params: {
  promptTokens: number;
  completionTokens: number;
}): number | undefined {
  const promptTokens = Math.max(0, params.promptTokens);
  const completionTokens = Math.max(0, params.completionTokens);

  if (promptTokens === 0 && completionTokens === 0) {
    return 0;
  }

  /**
   * Conservative placeholder estimate.
   * Replace with exact per-model pricing table later if needed.
   */
  const estimatedUsd =
    (promptTokens / 1_000_000) * 0.35 +
    (completionTokens / 1_000_000) * 1.05;

  return Number(estimatedUsd.toFixed(6));
}

export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;

  async generate(
    input: AiGenerationInput,
    route: ModelRouteDecision,
  ): Promise<AiGenerationOutput> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      throw new AiProviderConfigurationError(
        this.name,
        "Gemini is not configured: set GEMINI_API_KEY in the environment.",
      );
    }

    const responseFormat = route.responseFormat;
    const effectiveTemperature = resolveEffectiveTemperature(input, route);
    const effectiveMaxTokens = resolveEffectiveMaxTokens(input, route);

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
      model: route.model,
      taskType: input.taskType,
      planTier: input.planTier,
      responseFormat,
      messageCount: sourceMessages.length,
      conversationCount: contents.length,
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      jsonMode: responseFormat === "json",
      metadata: input.metadata ?? null,
    };

    const model = encodeURIComponent(route.model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
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
      const message =
        typeof payload === "object" && payload !== null && "error" in payload
          ? String(payload.error?.message ?? res.statusText)
          : res.statusText;

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
    const parts = candidate?.content?.parts ?? [];
    const text = parts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");

    if (!text.trim() && candidate?.finishReason) {
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
        : text.trim();

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

    const costEstimate = estimateGeminiCostUsd({
      promptTokens,
      completionTokens,
    });

    return {
      provider: this.name,
      model: route.model,
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      costEstimate,
      latencyMs,
      finishReason: mapGeminiFinishReason(candidate?.finishReason),
      raw: {
        request: requestSummary,
        json_mode: responseFormat === "json",
        estimated_cost_usd: costEstimate,
        finishReason: candidate?.finishReason,
        response: payload,
      },
    };
  }
}
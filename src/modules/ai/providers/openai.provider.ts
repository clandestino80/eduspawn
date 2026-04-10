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

type OpenAiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAiChatCompletionChoice = {
  finish_reason?: string | null;
  message?: {
    content?: string | null;
    refusal?: string | null;
  };
};

type OpenAiChatCompletionResponse = {
  id?: string;
  model?: string;
  created?: number;
  system_fingerprint?: string;
  choices?: OpenAiChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

type CostRates = {
  inputPerMillion: number;
  outputPerMillion: number;
};

/**
 * Conservative pricing table used only for internal estimation.
 * Adjust these values if your billing logic differs.
 */
const MODEL_COSTS: Readonly<Record<string, CostRates>> = {
  "gpt-4.1": {
    inputPerMillion: 2,
    outputPerMillion: 8,
  },
  "gpt-4.1-mini": {
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
  },
  "gpt-4.1-nano": {
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
  },
  "gpt-4o": {
    inputPerMillion: 2.5,
    outputPerMillion: 10,
  },
  "gpt-4o-mini": {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
  },
};

function mapOpenAiFinishReason(
  raw: string | null | undefined,
): AiGenerationOutput["finishReason"] {
  switch (raw) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return "unknown";
  }
}

function normalizeMessageContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function toOpenAiMessages(messages: AiMessage[]): OpenAiChatMessage[] {
  const normalized: OpenAiChatMessage[] = [];

  for (const message of messages) {
    if (
      message.role !== "system" &&
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      continue;
    }

    const content = normalizeMessageContent(message.content);

    if (!content) {
      continue;
    }

    const last = normalized[normalized.length - 1];

    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${content}`;
      continue;
    }

    normalized.push({
      role: message.role,
      content,
    });
  }

  return normalized;
}

function estimateOpenAiCostUsd(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number | undefined {
  const promptTokens = Math.max(0, params.promptTokens);
  const completionTokens = Math.max(0, params.completionTokens);

  if (promptTokens === 0 && completionTokens === 0) {
    return 0;
  }

  const rates = MODEL_COSTS[params.model];

  if (!rates) {
    return undefined;
  }

  const estimatedUsd =
    (promptTokens / 1_000_000) * rates.inputPerMillion +
    (completionTokens / 1_000_000) * rates.outputPerMillion;

  return Number(estimatedUsd.toFixed(6));
}

function extractOpenAiErrorMessage(
  payload: OpenAiChatCompletionResponse | string | null,
  fallback: string,
): string {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed || fallback;
  }

  if (payload?.error?.message) {
    return payload.error.message;
  }

  return fallback;
}

function extractChoiceText(choice: OpenAiChatCompletionChoice | undefined): {
  text: string;
  refusal: string;
} {
  const text =
    typeof choice?.message?.content === "string" ? choice.message.content : "";
  const refusal =
    typeof choice?.message?.refusal === "string" ? choice.message.refusal : "";

  return {
    text: text.trim(),
    refusal: refusal.trim(),
  };
}

export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;

  async generate(
    input: AiGenerationInput,
    route: ModelRouteDecision,
  ): Promise<AiGenerationOutput> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new AiProviderConfigurationError(
        this.name,
        "OpenAI is not configured: set OPENAI_API_KEY in the environment.",
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

    const messages = toOpenAiMessages(sourceMessages);

    if (messages.length === 0) {
      throw new AiProviderHttpError(
        this.name,
        400,
        "OpenAI requires at least one non-empty message.",
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

    const body: Record<string, unknown> = {
      model: route.model,
      messages,
      temperature: effectiveTemperature,
      max_tokens: effectiveMaxTokens,
    };

    if (responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    const requestSummary = {
      provider: this.name,
      model: route.model,
      taskType: input.taskType,
      planTier: input.planTier,
      responseFormat,
      messageCount: sourceMessages.length,
      normalizedMessageCount: messages.length,
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      jsonMode: responseFormat === "json",
      metadata: input.metadata ?? null,
    };

    const { signal, cancel } = createAbortHandle(PROVIDER_FETCH_TIMEOUT_MS);
    const started = Date.now();

    let res: Response;

    try {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      cancel();

      if (err instanceof Error && err.name === "AbortError") {
        throw new AiProviderHttpError(
          this.name,
          408,
          "OpenAI request timed out.",
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
        `OpenAI network error: ${
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
      | OpenAiChatCompletionResponse
      | string
      | null;

    if (!res.ok) {
      const message = extractOpenAiErrorMessage(payload, res.statusText);

      throw new AiProviderHttpError(
        this.name,
        res.status,
        `OpenAI API error: ${message}`,
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
        "OpenAI returned an unexpected response body.",
        {
          request: requestSummary,
          response: payload,
        },
      );
    }

    const choice = payload.choices?.[0];
    const { text, refusal } = extractChoiceText(choice);

    if (!text && refusal) {
      throw new AiProviderHttpError(
        this.name,
        422,
        `OpenAI refused to generate content: ${refusal}`,
        {
          refusal,
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

    const usage = payload.usage ?? {};
    const promptTokens = Math.max(0, Math.floor(usage.prompt_tokens ?? 0));
    const completionTokens = Math.max(
      0,
      Math.floor(usage.completion_tokens ?? 0),
    );
    const totalTokens = Math.max(
      0,
      Math.floor(usage.total_tokens ?? promptTokens + completionTokens),
    );

    const resolvedModel = payload.model ?? route.model;

    const costEstimate = estimateOpenAiCostUsd({
      model: resolvedModel,
      promptTokens,
      completionTokens,
    });

    return {
      provider: this.name,
      model: resolvedModel,
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      costEstimate,
      latencyMs,
      finishReason: mapOpenAiFinishReason(choice?.finish_reason),
      raw: {
        request: requestSummary,
        json_mode: responseFormat === "json",
        estimated_cost_usd: costEstimate,
        id: payload.id,
        created: payload.created,
        model: payload.model,
        system_fingerprint: payload.system_fingerprint,
        finish_reason: choice?.finish_reason,
        response: payload,
      },
    };
  }
}
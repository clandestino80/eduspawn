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

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string;
};

type AnthropicContentBlock = {
  type?: string;
  text?: string;
};

type AnthropicResponse = {
  id?: string;
  model?: string;
  role?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
};

type CostRates = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

/**
 * Legacy aliases supported for backward compatibility.
 * Current router/env values like:
 * - claude-haiku-4-5
 * - claude-sonnet-4-6
 * - claude-opus-4-6
 * are passed through unchanged.
 */
const LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3-7-sonnet": "claude-3-7-sonnet-20250219",
};

/**
 * Conservative estimation table.
 * Keep intentionally sparse unless you want to maintain exact pricing.
 */
const MODEL_COSTS: Readonly<Record<string, CostRates>> = {
  "claude-3-5-sonnet-20241022": {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  "claude-3-7-sonnet-20250219": {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
};

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function getAnthropicBaseUrl(): string {
  return (readEnv("ANTHROPIC_BASE_URL") ?? DEFAULT_ANTHROPIC_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

function getAnthropicVersion(): string {
  return readEnv("ANTHROPIC_VERSION") ?? DEFAULT_ANTHROPIC_VERSION;
}

function resolveAnthropicModelId(model: string): string {
  const trimmed = model.trim();

  if (!trimmed) {
    return trimmed;
  }

  if (LEGACY_MODEL_ALIASES[trimmed]) {
    return LEGACY_MODEL_ALIASES[trimmed];
  }

  return trimmed;
}

function normalizeMessageContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function splitSystemAndConversation(messages: AiMessage[]): {
  system: string;
  conversation: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const nonSystem: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [];

  for (const message of messages) {
    const normalizedContent = normalizeMessageContent(message.content);

    if (!normalizedContent) {
      continue;
    }

    if (message.role === "system") {
      systemParts.push(normalizedContent);
      continue;
    }

    if (message.role === "user" || message.role === "assistant") {
      nonSystem.push({
        role: message.role,
        content: normalizedContent,
      });
    }
  }

  const merged: AnthropicMessage[] = [];

  for (const message of nonSystem) {
    const last = merged[merged.length - 1];

    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${message.content}`;
      continue;
    }

    merged.push({
      role: message.role,
      content: message.content,
    });
  }

  if (merged.length > 0 && merged[0]?.role === "assistant") {
    merged.unshift({
      role: "user",
      content:
        "Use the following assistant context as continuation of a prior turn and respond accordingly.",
    });
  }

  return {
    system: systemParts.join("\n\n").trim(),
    conversation: merged,
  };
}


function mapAnthropicFinishReason(
  raw: string | null | undefined,
): AiGenerationOutput["finishReason"] {
  switch (raw) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_use";
    default:
      return "unknown";
  }
}

function resolveAnthropicCostRates(model: string): CostRates | undefined {
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

function estimateAnthropicCostUsd(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number | undefined {
  const promptTokens = Math.max(0, params.promptTokens);
  const completionTokens = Math.max(0, params.completionTokens);

  if (promptTokens === 0 && completionTokens === 0) {
    return 0;
  }

  const rates = resolveAnthropicCostRates(params.model);

  if (!rates) {
    return undefined;
  }

  const estimatedUsd =
    (promptTokens / 1_000_000) * rates.inputPerMillion +
    (completionTokens / 1_000_000) * rates.outputPerMillion;

  return Number(estimatedUsd.toFixed(6));
}

function extractAnthropicErrorMessage(
  payload: AnthropicResponse | string | null,
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

function extractAnthropicText(payload: AnthropicResponse): {
  text: string;
  contentTypes: string[];
} {
  if (!Array.isArray(payload.content)) {
    return {
      text: "",
      contentTypes: [],
    };
  }

  const contentTypes = payload.content
    .map((block) => block?.type)
    .filter((type): type is string => typeof type === "string");

  const text = payload.content
    .filter(
      (block) => block?.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text ?? "")
    .join("")
    .trim();

  return {
    text,
    contentTypes,
  };
}

function buildAnthropicHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": getAnthropicVersion(),
    "Content-Type": "application/json",
  };

  const beta = readEnv("ANTHROPIC_BETA");

  if (beta) {
    headers["anthropic-beta"] = beta;
  }

  return headers;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;

  async generate(
    input: AiGenerationInput,
    route: ModelRouteDecision,
  ): Promise<AiGenerationOutput> {
    const apiKey = readEnv("ANTHROPIC_API_KEY");

    if (!apiKey) {
      throw new AiProviderConfigurationError(
        this.name,
        "Anthropic is not configured: set ANTHROPIC_API_KEY in the environment.",
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

    const { system, conversation } = splitSystemAndConversation(sourceMessages);

    if (conversation.length === 0) {
      throw new AiProviderHttpError(
        this.name,
        400,
        "Anthropic requires at least one user or assistant message.",
        {
          request: {
            provider: this.name,
            endpoint: `${getAnthropicBaseUrl()}/v1/messages`,
            model: route.model,
            taskType: input.taskType,
            planTier: input.planTier,
            responseFormat,
            messageCount: sourceMessages.length,
          },
        },
      );
    }

    const modelId = resolveAnthropicModelId(route.model);

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: effectiveMaxTokens,
      temperature: effectiveTemperature,
      messages: conversation,
    };

    if (system) {
      body.system = system;
    }

    const requestSummary = {
      provider: this.name,
      endpoint: `${getAnthropicBaseUrl()}/v1/messages`,
      model: modelId,
      originalRouteModel: route.model,
      taskType: input.taskType,
      planTier: input.planTier,
      responseFormat,
      messageCount: sourceMessages.length,
      conversationCount: conversation.length,
      hasSystemPrompt: Boolean(system),
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      jsonMode: responseFormat === "json",
      metadata: input.metadata ?? null,
    };

    const { signal, cancel } = createAbortHandle(PROVIDER_FETCH_TIMEOUT_MS);
    const started = Date.now();

    let res: Response;

    try {
      res = await fetch(`${getAnthropicBaseUrl()}/v1/messages`, {
        method: "POST",
        headers: buildAnthropicHeaders(apiKey),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      cancel();

      if (err instanceof Error && err.name === "AbortError") {
        throw new AiProviderHttpError(
          this.name,
          408,
          "Anthropic request timed out.",
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
        `Anthropic network error: ${
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
      | AnthropicResponse
      | string
      | null;

    if (!res.ok) {
      const message = extractAnthropicErrorMessage(payload, res.statusText);

      throw new AiProviderHttpError(
        this.name,
        res.status,
        `Anthropic API error: ${message}`,
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
        "Anthropic returned an unexpected response body.",
        {
          request: requestSummary,
          response: payload,
        },
      );
    }

    const extracted = extractAnthropicText(payload);

    if (!extracted.text && extracted.contentTypes.length > 0) {
      throw new AiProviderHttpError(
        this.name,
        422,
        `Anthropic returned no text content. Content block types: ${extracted.contentTypes.join(", ")}`,
        {
          request: requestSummary,
          response: payload,
        },
      );
    }

    const content: unknown =
      responseFormat === "json"
        ? normalizeJsonModeContent(extracted.text)
        : extracted.text;

    assertNonEmptyContent(content, this.name);

    const usage = payload.usage ?? {};
    const promptTokens = Math.max(0, Math.floor(usage.input_tokens ?? 0));
    const completionTokens = Math.max(0, Math.floor(usage.output_tokens ?? 0));
    const totalTokens = promptTokens + completionTokens;

    const resolvedResponseModel = payload.model ?? modelId;
    const costEstimate = estimateAnthropicCostUsd({
      model: resolvedResponseModel,
      promptTokens,
      completionTokens,
    });

    const output: AiGenerationOutput = {
  provider: this.name,
  model: resolvedResponseModel,
  content,
  usage: {
    promptTokens,
    completionTokens,
    totalTokens,
  },
  latencyMs,
  finishReason: mapAnthropicFinishReason(payload.stop_reason),
  raw: {
    request: requestSummary,
    json_mode: responseFormat === "json",
    estimated_cost_usd: costEstimate,
    id: payload.id,
    model: payload.model,
    role: payload.role,
    stop_reason: payload.stop_reason,
    stop_sequence: payload.stop_sequence,
    response: payload,
  },
};

if (costEstimate !== undefined) {
  output.costEstimate = costEstimate;
}

return output;

  }
}
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
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
};

const ANTHROPIC_VERSION = "2023-06-01";

const MODEL_ALIASES: Readonly<Record<string, string>> = {
  "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3-7-sonnet": "claude-3-7-sonnet-20250219",
};

type CostRates = {
  inputPerMillion: number;
  outputPerMillion: number;
};

/**
 * Conservative pricing defaults used only for estimation.
 * Keep these aligned with your internal billing assumptions if needed.
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

function resolveAnthropicModelId(model: string): string {
  const trimmed = model.trim();

  if (!trimmed) {
    return trimmed;
  }

  if (/-\d{8}$/.test(trimmed)) {
    return trimmed;
  }

  return MODEL_ALIASES[trimmed] ?? trimmed;
}

function normalizeMessageContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function splitSystemAndConversation(messages: AiMessage[]): {
  system: string;
  conversation: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const nonSystem: AiMessage[] = [];

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
        ...message,
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

  /**
   * Anthropic expects the conversation to begin with a user turn.
   * If upstream context starts with assistant, prepend a bridging user turn.
   */
  if (merged.length > 0 && merged[0]?.role === "assistant") {
    merged.unshift({
      role: "user",
      content:
        "Use the following assistant context as continuation of a prior turn; respond accordingly.",
    });
  }

  return {
    system: systemParts.join("\n\n").trim(),
    conversation: merged,
  };
}

function mapAnthropicFinishReason(
  raw: string | null | undefined
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

  const rates = MODEL_COSTS[params.model];

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
  fallback: string
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

function extractAnthropicText(payload: AnthropicResponse): string {
  if (!Array.isArray(payload.content)) {
    return "";
  }

  return payload.content
    .filter(
      (block) => block?.type === "text" && typeof block.text === "string"
    )
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;

  async generate(
    input: AiGenerationInput,
    route: ModelRouteDecision
  ): Promise<AiGenerationOutput> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

    if (!apiKey) {
      throw new AiProviderConfigurationError(
        this.name,
        "Anthropic is not configured: set ANTHROPIC_API_KEY in the environment."
      );
    }

    const responseFormat = route.responseFormat;
    const effectiveTemperature = resolveEffectiveTemperature(input, route);
    const effectiveMaxTokens = Math.max(
      1,
      resolveEffectiveMaxTokens(input, route)
    );

    const sourceMessages =
      responseFormat === "json"
        ? augmentMessagesForJsonMode(input.messages)
        : input.messages;

    const { system, conversation } =
      splitSystemAndConversation(sourceMessages);

    if (conversation.length === 0) {
      throw new AiProviderHttpError(
        this.name,
        400,
        "Anthropic requires at least one user or assistant message.",
        {
          request: {
            provider: this.name,
            model: route.model,
            taskType: input.taskType,
            planTier: input.planTier,
            responseFormat,
            messageCount: sourceMessages.length,
          },
        }
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
      model: modelId,
      taskType: input.taskType,
      planTier: input.planTier,
      responseFormat,
      messageCount: sourceMessages.length,
      conversationCount: conversation.length,
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      jsonMode: responseFormat === "json",
      metadata: input.metadata ?? null,
    };

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    };

    const { signal, cancel } = createAbortHandle(PROVIDER_FETCH_TIMEOUT_MS);
    const started = Date.now();

    let res: Response;

    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
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
          }
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
        }
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
        }
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
        }
      );
    }

    const rawText = extractAnthropicText(payload);

    const content: unknown =
      responseFormat === "json"
        ? normalizeJsonModeContent(rawText)
        : rawText;

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

    return {
      provider: this.name,
      model: resolvedResponseModel,
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      costEstimate,
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
        response: payload,
      },
    };
  }
}
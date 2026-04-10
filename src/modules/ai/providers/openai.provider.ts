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

type OpenAiResponsesInputItem = {
  role: "system" | "user" | "assistant";
  content: Array<{ type: "input_text"; text: string }>;
};

type OpenAiResponsesOutputContent = {
  type?: string;
  text?: string | null;
  refusal?: string | null;
};

type OpenAiResponsesOutputItem = {
  type?: string;
  role?: string;
  status?: string;
  content?: OpenAiResponsesOutputContent[];
};

type OpenAiResponsesResponse = {
  id?: string;
  model?: string;
  created_at?: number;
  status?: string;
  output?: OpenAiResponsesOutputItem[];
  output_text?: string | string[];
  incomplete_details?: {
    reason?: string | null;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function normalizeMessageContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function toOpenAiChatMessages(messages: AiMessage[]): OpenAiChatMessage[] {
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
    if (!content) continue;

    const last = normalized[normalized.length - 1];

    if (last && last.role === message.role) {
      last.content += `\n\n${content}`;
    } else {
      normalized.push({ role: message.role, content });
    }
  }

  return normalized;
}

function toOpenAiResponsesInput(
  messages: AiMessage[],
): OpenAiResponsesInputItem[] {
  return toOpenAiChatMessages(messages).map((message) => ({
    role: message.role,
    content: [{ type: "input_text", text: message.content }],
  }));
}

function shouldUseResponsesApi(model: string): boolean {
  return model.trim().toLowerCase().startsWith("gpt-5");
}

function getOpenAiBaseUrl(): string {
  return (readEnv("OPENAI_BASE_URL") ?? DEFAULT_OPENAI_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

function buildOpenAiHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const org = readEnv("OPENAI_ORGANIZATION");
  const proj = readEnv("OPENAI_PROJECT");

  if (org) headers["OpenAI-Organization"] = org;
  if (proj) headers["OpenAI-Project"] = proj;

  return headers;
}

function mapChatFinishReason(
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

function mapResponsesFinishReason(
  status: string | null | undefined,
  incompleteReason?: string | null,
): AiGenerationOutput["finishReason"] {
  if (status === "completed") {
    return "stop";
  }

  if (
    incompleteReason === "max_output_tokens" ||
    incompleteReason === "max_tokens"
  ) {
    return "length";
  }

  return "unknown";
}

function extractOpenAiErrorMessage(
  payload:
    | OpenAiChatCompletionResponse
    | OpenAiResponsesResponse
    | string
    | null,
  fallback: string,
): string {
  if (typeof payload === "string") {
    return payload.trim() || fallback;
  }

  if (payload?.error?.message) {
    return payload.error.message;
  }

  return fallback;
}

function extractChatText(choice?: OpenAiChatCompletionChoice): {
  text: string;
  refusal: string;
} {
  return {
    text: choice?.message?.content?.trim() || "",
    refusal: choice?.message?.refusal?.trim() || "",
  };
}

function extractResponsesText(payload: OpenAiResponsesResponse): {
  text: string;
  refusal: string;
} {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return {
      text: payload.output_text.trim(),
      refusal: "",
    };
  }

  if (Array.isArray(payload.output_text)) {
    const joined = payload.output_text
      .filter((item): item is string => typeof item === "string")
      .join("\n")
      .trim();

    if (joined) {
      return {
        text: joined,
        refusal: "",
      };
    }
  }

  let text = "";
  let refusal = "";

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (!text && typeof content.text === "string" && content.text.trim()) {
        text = content.text.trim();
      }

      if (
        !refusal &&
        typeof content.refusal === "string" &&
        content.refusal.trim()
      ) {
        refusal = content.refusal.trim();
      }
    }
  }

  return { text, refusal };
}

async function postJson<T>(
  url: string,
  apiKey: string,
  body: object,
  requestSummary: Record<string, unknown>,
): Promise<{ response: Response; payload: T | string | null; latencyMs: number }> {
  const { signal, cancel } = createAbortHandle(PROVIDER_FETCH_TIMEOUT_MS);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildOpenAiHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });

    const payload = (await readResponseBody(response)) as T | string | null;

    return {
      response,
      payload,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiProviderHttpError(
        "openai",
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
      "openai",
      0,
      `OpenAI network error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        cause: String(error),
        request: requestSummary,
      },
    );
  } finally {
    cancel();
  }
}

export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;

  async generate(
    input: AiGenerationInput,
    route: ModelRouteDecision,
  ): Promise<AiGenerationOutput> {
    const apiKey = readEnv("OPENAI_API_KEY");

    if (!apiKey) {
      throw new AiProviderConfigurationError(
        this.name,
        "Missing OPENAI_API_KEY",
      );
    }

    const sourceMessages =
      route.responseFormat === "json"
        ? augmentMessagesForJsonMode(input.messages)
        : input.messages;

    if (shouldUseResponsesApi(route.model)) {
      return this.generateResponses(apiKey, input, route, sourceMessages);
    }

    return this.generateChat(apiKey, input, route, sourceMessages);
  }

  private async generateChat(
    apiKey: string,
    input: AiGenerationInput,
    route: ModelRouteDecision,
    messages: AiMessage[],
  ): Promise<AiGenerationOutput> {
    const normalizedMessages = toOpenAiChatMessages(messages);

    if (normalizedMessages.length === 0) {
      throw new AiProviderHttpError(
        this.name,
        400,
        "OpenAI requires at least one non-empty message.",
        {
          provider: this.name,
          model: route.model,
          taskType: input.taskType,
          planTier: input.planTier,
          responseFormat: route.responseFormat,
          messageCount: messages.length,
        },
      );
    }

    const body: Record<string, unknown> = {
      model: route.model,
      messages: normalizedMessages,
      temperature: resolveEffectiveTemperature(input, route),
      max_tokens: resolveEffectiveMaxTokens(input, route),
    };

    if (route.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    const requestSummary = {
      provider: this.name,
      apiStyle: "chat_completions",
      endpoint: `${getOpenAiBaseUrl()}/chat/completions`,
      model: route.model,
      taskType: input.taskType,
      planTier: input.planTier,
      responseFormat: route.responseFormat,
      messageCount: messages.length,
      normalizedMessageCount: normalizedMessages.length,
      temperature: resolveEffectiveTemperature(input, route),
      maxTokens: resolveEffectiveMaxTokens(input, route),
      jsonMode: route.responseFormat === "json",
      metadata: input.metadata ?? null,
    };

    const { response, payload, latencyMs } =
      await postJson<OpenAiChatCompletionResponse>(
        `${getOpenAiBaseUrl()}/chat/completions`,
        apiKey,
        body,
        requestSummary,
      );

    if (!response.ok) {
      throw new AiProviderHttpError(
        this.name,
        response.status,
        `OpenAI API error: ${extractOpenAiErrorMessage(payload, response.statusText)}`,
        {
          request: requestSummary,
          response: payload,
        },
      );
    }

    if (typeof payload !== "object" || payload === null) {
      throw new AiProviderHttpError(
        this.name,
        response.status,
        "OpenAI returned an unexpected response body.",
        {
          request: requestSummary,
          response: payload,
        },
      );
    }

    const choice = payload.choices?.[0];
    const { text, refusal } = extractChatText(choice);

    if (!text && refusal) {
      throw new AiProviderHttpError(
        this.name,
        422,
        `OpenAI refused to generate content: ${refusal}`,
        {
          request: requestSummary,
          response: payload,
          refusal,
        },
      );
    }

    const content: unknown =
      route.responseFormat === "json"
        ? normalizeJsonModeContent(text)
        : text;

    assertNonEmptyContent(content, this.name);

    return {
      provider: this.name,
      model: payload.model ?? route.model,
      content,
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
      },
      latencyMs,
      finishReason: mapChatFinishReason(choice?.finish_reason),
      raw: {
        request: requestSummary,
        id: payload.id,
        created: payload.created,
        model: payload.model,
        system_fingerprint: payload.system_fingerprint,
        finish_reason: choice?.finish_reason,
        response: payload,
      },
    };
  }

  private async generateResponses(
    apiKey: string,
    input: AiGenerationInput,
    route: ModelRouteDecision,
    messages: AiMessage[],
  ): Promise<AiGenerationOutput> {
    const responseInput = toOpenAiResponsesInput(messages);

    if (responseInput.length === 0) {
      throw new AiProviderHttpError(
        this.name,
        400,
        "OpenAI requires at least one non-empty message.",
        {
          provider: this.name,
          model: route.model,
          taskType: input.taskType,
          planTier: input.planTier,
          responseFormat: route.responseFormat,
          messageCount: messages.length,
        },
      );
    }

    const body: Record<string, unknown> = {
      model: route.model,
      input: responseInput,
      temperature: resolveEffectiveTemperature(input, route),
      max_output_tokens: resolveEffectiveMaxTokens(input, route),
    };

    if (route.responseFormat === "json") {
      body.text = {
        format: {
          type: "json_object",
        },
      };
    }

    const requestSummary = {
      provider: this.name,
      apiStyle: "responses",
      endpoint: `${getOpenAiBaseUrl()}/responses`,
      model: route.model,
      taskType: input.taskType,
      planTier: input.planTier,
      responseFormat: route.responseFormat,
      messageCount: messages.length,
      normalizedMessageCount: responseInput.length,
      temperature: resolveEffectiveTemperature(input, route),
      maxTokens: resolveEffectiveMaxTokens(input, route),
      jsonMode: route.responseFormat === "json",
      metadata: input.metadata ?? null,
    };

    const { response, payload, latencyMs } =
      await postJson<OpenAiResponsesResponse>(
        `${getOpenAiBaseUrl()}/responses`,
        apiKey,
        body,
        requestSummary,
      );

    if (!response.ok) {
      throw new AiProviderHttpError(
        this.name,
        response.status,
        `OpenAI API error: ${extractOpenAiErrorMessage(payload, response.statusText)}`,
        {
          request: requestSummary,
          response: payload,
        },
      );
    }

    if (typeof payload !== "object" || payload === null) {
      throw new AiProviderHttpError(
        this.name,
        response.status,
        "OpenAI returned an unexpected response body.",
        {
          request: requestSummary,
          response: payload,
        },
      );
    }

    const { text, refusal } = extractResponsesText(payload);

    if (!text && refusal) {
      throw new AiProviderHttpError(
        this.name,
        422,
        `OpenAI refused to generate content: ${refusal}`,
        {
          request: requestSummary,
          response: payload,
          refusal,
        },
      );
    }

    const content: unknown =
      route.responseFormat === "json"
        ? normalizeJsonModeContent(text)
        : text;

    assertNonEmptyContent(content, this.name);

    return {
      provider: this.name,
      model: payload.model ?? route.model,
      content,
      usage: {
        promptTokens: payload.usage?.input_tokens ?? 0,
        completionTokens: payload.usage?.output_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
      },
      latencyMs,
      finishReason: mapResponsesFinishReason(
        payload.status,
        payload.incomplete_details?.reason,
      ),
      raw: {
        request: requestSummary,
        id: payload.id,
        created_at: payload.created_at,
        model: payload.model,
        status: payload.status,
        incomplete_reason: payload.incomplete_details?.reason,
        response: payload,
      },
    };
  }
}
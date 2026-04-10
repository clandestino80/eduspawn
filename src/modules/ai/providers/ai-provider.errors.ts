import type { AiProviderName } from "./ai-provider.types";

export class AiProviderConfigurationError extends Error {
  readonly code = "MISSING_API_KEY" as const;
  readonly provider: AiProviderName;

  constructor(provider: AiProviderName, message: string) {
    super(message);
    this.name = "AiProviderConfigurationError";
    this.provider = provider;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AiProviderHttpError extends Error {
  readonly code = "API_ERROR" as const;
  readonly provider: AiProviderName;
  readonly statusCode: number;
  readonly body: unknown;

  constructor(
    provider: AiProviderName,
    statusCode: number,
    message: string,
    body: unknown,
  ) {
    super(message);
    this.name = "AiProviderHttpError";
    this.provider = provider;
    this.statusCode = statusCode;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AiProviderResponseError extends Error {
  readonly provider: AiProviderName;
  readonly responseCode: "EMPTY_RESPONSE" | "INVALID_RESPONSE";

  constructor(
    provider: AiProviderName,
    responseCode: "EMPTY_RESPONSE" | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "AiProviderResponseError";
    this.provider = provider;
    this.responseCode = responseCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

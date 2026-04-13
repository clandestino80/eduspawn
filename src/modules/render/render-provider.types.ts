import type { CreatorPackKind, RenderProviderKind } from "@prisma/client";

/** Provider-agnostic payload built from owned creator pack JSON (never send raw secrets). */
export type InternalRenderNarrativePayload = {
  packKind: CreatorPackKind;
  /** Minimal script/visual bundle for a video provider prompt (structured, not vendor-specific). */
  script: Record<string, unknown>;
  targetDurationSec: number;
  targetPlatform: string;
  renderPreset?: string;
  sourceIntent: "SYSTEM_ORIGINAL" | "USER_EDITED_PRIVATE";
};

export type SubmitRenderInput = {
  renderJobId: string;
  userId: string;
  creatorPackId: string;
  narrative: InternalRenderNarrativePayload;
};

export type SubmitRenderOk = {
  ok: true;
  providerJobId: string;
  metadataJson?: Record<string, unknown>;
};

export type SubmitRenderErr = {
  ok: false;
  errorCode: string;
  message: string;
};

export type SubmitRenderResult = SubmitRenderOk | SubmitRenderErr;

export type RenderStatusOk = {
  ok: true;
  status: "QUEUED" | "SUBMITTED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  outputUrl?: string;
  thumbnailUrl?: string;
  failureReason?: string;
  metadataJson?: Record<string, unknown>;
};

export type RenderStatusErr = { ok: false; errorCode: string; message: string };

export type RenderStatusResult = RenderStatusOk | RenderStatusErr;

/** Normalized provider callback after vendor-specific parsing (internal pipeline only). */
export type ParsedProviderWebhook = {
  provider: RenderProviderKind;
  providerJobId: string;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
  outputUrl?: string;
  thumbnailUrl?: string;
  failureReason?: string;
};

/** Case-insensitive header lookup for webhook verification helpers. */
export type WebhookHeaderBag = {
  get(name: string): string | undefined;
};

/** Per-provider adapter (Kling, stub, future vendors). */
export type RenderProviderAdapter = {
  readonly kind: "KLING" | "KLING_STUB";
  submitRender(input: SubmitRenderInput): Promise<SubmitRenderResult>;
  getRenderStatus(args: { providerJobId: string }): Promise<RenderStatusResult>;
  /**
   * When the HTTP callback body is vendor-native (not EduSpawn’s envelope), map it here.
   * Return null if this adapter does not recognize the payload.
   */
  parseProviderWebhook?(raw: unknown, headers: WebhookHeaderBag): ParsedProviderWebhook | null;
};

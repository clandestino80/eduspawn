import { getEnv } from "../../../config/env";
import { KLING_TEXT2VIDEO_PATH, klingVideoTaskPath } from "./kling/kling-api.constants";
import { parseKlingProviderCallback } from "./kling/kling-callback.parse";
import { klingHttpJson, type KlingHttpDeps } from "./kling/kling-http.client";
import { buildKlingTextPrompt } from "./kling/kling-prompt";
import { extractKlingSubmitTaskId, mapKlingPollToRenderStatus } from "./kling/kling-response.parse";
import type {
  RenderProviderAdapter,
  RenderStatusResult,
  SubmitRenderInput,
  SubmitRenderResult,
  WebhookHeaderBag,
} from "../render-provider.types";

function clampKlingDurationSeconds(sec: number): 5 | 10 {
  if (sec <= 5) return 5;
  return 10;
}

function buildText2VideoBody(args: {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  mode?: string;
  negativePrompt?: string;
}): Record<string, unknown> {
  const env = getEnv();
  const body: Record<string, unknown> = {
    model: env.RENDER_KLING_MODEL,
    prompt: args.prompt,
    duration: clampKlingDurationSeconds(args.durationSec),
    aspect_ratio: args.aspectRatio,
  };
  if (args.mode) body.mode = args.mode;
  if (args.negativePrompt?.trim()) body.negative_prompt = args.negativePrompt.trim().slice(0, 500);
  const cb = env.RENDER_KLING_CALLBACK_URL?.trim();
  if (cb) body.callback_url = cb;
  return body;
}

/**
 * Live Kling HTTP adapter using https://klingapi.com/docs:
 * - POST `/v1/videos/text2video` (Bearer `RENDER_KLING_API_KEY`)
 * - GET `/v1/videos/{task_id}` for status
 *
 * Optional `callback_url` is sent when `RENDER_KLING_CALLBACK_URL` is set (community SDKs document this field name).
 * Kling’s public docs page does not specify a vendor-signed webhook body; keep `RENDER_WEBHOOK_SECRET` on our ingress.
 */
export function createKlingRenderAdapter(deps?: KlingHttpDeps): RenderProviderAdapter {
  return {
    kind: "KLING",
    parseProviderWebhook(raw: unknown, _headers: WebhookHeaderBag) {
      void _headers;
      return parseKlingProviderCallback(raw);
    },
    async submitRender(input: SubmitRenderInput): Promise<SubmitRenderResult> {
      const env = getEnv();
      const key = env.RENDER_KLING_API_KEY?.trim();
      if (!key) {
        return {
          ok: false,
          errorCode: "KLING_NOT_CONFIGURED",
          message:
            "Kling render requires RENDER_KLING_API_KEY. Use KLING_STUB or set credentials (see https://klingapi.com/docs).",
        };
      }

      const prompt = buildKlingTextPrompt(input.narrative.script, input.narrative.packKind);
      if (!prompt.trim()) {
        return {
          ok: false,
          errorCode: "KLING_EMPTY_PROMPT",
          message: "Cannot submit render: empty prompt derived from creator pack script.",
        };
      }

      const body = buildText2VideoBody({
        prompt,
        durationSec: input.narrative.targetDurationSec,
        aspectRatio: env.RENDER_KLING_DEFAULT_ASPECT_RATIO,
        mode: env.RENDER_KLING_DEFAULT_MODE,
        negativePrompt: env.RENDER_KLING_NEGATIVE_PROMPT,
      });

      const res = await klingHttpJson(deps, {
        method: "POST",
        path: KLING_TEXT2VIDEO_PATH,
        body,
      });

      if (!res.ok) {
        return {
          ok: false,
          errorCode: res.errorCode,
          message: res.message,
        };
      }

      const taskId = extractKlingSubmitTaskId(res.json);
      if (!taskId) {
        return {
          ok: false,
          errorCode: "KLING_UNEXPECTED_RESPONSE",
          message: "Kling API returned success but no task_id in JSON body.",
        };
      }

      return {
        ok: true,
        providerJobId: taskId,
        metadataJson: {
          klingModel: env.RENDER_KLING_MODEL,
          duration: body.duration,
          aspect_ratio: body.aspect_ratio,
        },
      };
    },
    async getRenderStatus(args: { providerJobId: string }): Promise<RenderStatusResult> {
      const env = getEnv();
      if (!env.RENDER_KLING_API_KEY?.trim()) {
        return {
          ok: false,
          errorCode: "KLING_NOT_CONFIGURED",
          message: "RENDER_KLING_API_KEY is not set.",
        };
      }

      const res = await klingHttpJson(deps, {
        method: "GET",
        path: klingVideoTaskPath(args.providerJobId),
      });

      if (!res.ok) {
        return {
          ok: false,
          errorCode: res.errorCode,
          message: res.message,
        };
      }

      return mapKlingPollToRenderStatus(res.json);
    },
  };
}

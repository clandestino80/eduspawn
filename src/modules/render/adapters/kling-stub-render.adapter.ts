import { getEnv } from "../../../config/env";
import type {
  RenderProviderAdapter,
  RenderStatusResult,
  SubmitRenderInput,
  SubmitRenderResult,
  WebhookHeaderBag,
} from "../render-provider.types";

export function createKlingStubRenderAdapter(): RenderProviderAdapter {
  return {
    kind: "KLING_STUB",
    parseProviderWebhook(_raw: unknown, _headers: WebhookHeaderBag) {
      void _raw;
      void _headers;
      return null;
    },
    async submitRender(input: SubmitRenderInput): Promise<SubmitRenderResult> {
      const mode = getEnv().RENDER_KLING_STUB_MODE;
      if (mode === "submit_ok") {
        return {
          ok: true,
          providerJobId: `stub-${input.renderJobId}`,
          metadataJson: { stubMode: "submit_ok", simulated: true },
        };
      }
      return {
        ok: false,
        errorCode: "STUB_SUBMIT_REJECTED",
        message:
          "Kling stub adapter is configured to reject submits (RENDER_KLING_STUB_MODE=submit_fail). Set RENDER_KLING_STUB_MODE=submit_ok for dry-run success paths.",
      };
    },
    async getRenderStatus(args: { providerJobId: string }): Promise<RenderStatusResult> {
      const mode = getEnv().RENDER_KLING_STUB_MODE;
      if (mode === "submit_ok" && args.providerJobId.startsWith("stub-")) {
        return {
          ok: true,
          status: "SUCCEEDED",
          outputUrl: "https://example.invalid/eduspawn-stub-render-output.mp4",
          thumbnailUrl: "https://example.invalid/eduspawn-stub-thumb.jpg",
          metadataJson: { stubSimulated: true },
        };
      }
      return {
        ok: true,
        status: "FAILED",
        failureReason: "Stub adapter did not simulate a completed render.",
      };
    },
  };
}

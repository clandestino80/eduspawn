import type { RenderProviderKind } from "@prisma/client";
import { createKlingRenderAdapter } from "./kling-render.adapter";
import { createKlingStubRenderAdapter } from "./kling-stub-render.adapter";
import type { RenderProviderAdapter } from "../render-provider.types";

export function getRenderProviderAdapter(kind: RenderProviderKind): RenderProviderAdapter {
  if (kind === "KLING_STUB") {
    return createKlingStubRenderAdapter();
  }
  return createKlingRenderAdapter();
}

import type { Prisma } from "@prisma/client";
import { getEnv } from "../../../config/env";
import { AppError } from "../../../lib/errors";
import { logProductEvent } from "../../../lib/product-log";
import { stripeWebhookEventToIntents } from "../adapters/stripe-billing.adapter";
import type { StripeWebhookEventJson } from "../adapters/stripe-webhook-verify";
import { verifyStripeWebhookBuffer } from "../adapters/stripe-webhook-verify";
import * as repo from "../repositories/billing-provider-event.repository";
import {
  applyNormalizedBillingIntents,
  assertStripePayloadShape,
} from "./billing-event-processor.service";

export async function processStripeEventAfterPersist(
  rowId: string,
  parsed: StripeWebhookEventJson,
): Promise<{
  duplicate?: boolean;
  ignored?: boolean;
  deferred?: boolean;
  ok?: boolean;
  error?: string;
}> {
  const row = await repo.findBillingProviderEventById(rowId);
  if (!row) {
    return { error: "row_not_found" };
  }
  if (row.processingStatus === "PROCESSED" || row.processingStatus === "IGNORED") {
    return { duplicate: true };
  }
  const claimed = await repo.claimBillingProviderEventForProcessing(rowId);
  if (!claimed) {
    const r2 = await repo.findBillingProviderEventById(rowId);
    if (r2?.processingStatus === "PROCESSED" || r2?.processingStatus === "IGNORED") {
      return { duplicate: true };
    }
    return { deferred: true };
  }
  const adapted = stripeWebhookEventToIntents(parsed);
  try {
    if (adapted.intents.every((i) => i.kind === "noop")) {
      await repo.markBillingProviderEventIgnored(rowId);
      return { ignored: true };
    }
    await applyNormalizedBillingIntents({
      intents: adapted.intents,
      provider: "STRIPE",
      providerEventId: parsed.id,
    });
    await repo.markBillingProviderEventProcessed(rowId);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await repo.markBillingProviderEventFailed(rowId, msg);
    return { error: msg };
  }
}

export async function ingestStripeWebhook(
  rawBody: Buffer,
  stripeSignature: string | undefined,
): Promise<{
  httpStatus: number;
  body: Record<string, unknown>;
}> {
  const secret = getEnv().STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    logProductEvent("stripe_webhook_disabled", {});
    return {
      httpStatus: 503,
      body: { success: false, error: { code: "STRIPE_WEBHOOKS_DISABLED" } },
    };
  }

  let parsed: StripeWebhookEventJson;
  try {
    parsed = verifyStripeWebhookBuffer(rawBody, stripeSignature, secret);
  } catch {
    logProductEvent("stripe_webhook_signature_invalid", {});
    return {
      httpStatus: 400,
      body: { success: false, error: { code: "STRIPE_SIGNATURE_INVALID" } },
    };
  }

  const maxEventAgeSec = getEnv().STRIPE_WEBHOOK_MAX_EVENT_AGE_SEC;
  if (maxEventAgeSec > 0 && typeof parsed.created === "number" && Number.isFinite(parsed.created)) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - parsed.created > maxEventAgeSec) {
      logProductEvent("stripe_webhook_event_too_old", {
        eventId: parsed.id,
        eventCreated: parsed.created,
        maxEventAgeSec,
      });
      return {
        httpStatus: 400,
        body: { success: false, error: { code: "STRIPE_EVENT_TOO_OLD" } },
      };
    }
  }

  logProductEvent("stripe_webhook_received", { eventId: parsed.id, type: parsed.type });

  const adapted = stripeWebhookEventToIntents(parsed);

  let row = await repo.findBillingProviderEventByProviderAndEventId({
    provider: "STRIPE",
    providerEventId: parsed.id,
  });

  if (!row) {
    await repo.createBillingProviderEventReceived({
      provider: "STRIPE",
      providerEventId: parsed.id,
      eventType: parsed.type,
      normalizedEventType: adapted.normalizedEventType,
      userId: adapted.userIdHint,
      externalCustomerId: adapted.externalCustomerId,
      externalSubscriptionId: adapted.externalSubscriptionId,
      externalProductId: adapted.externalProductId,
      payloadJson: parsed as unknown as Prisma.InputJsonValue,
    });
    row = await repo.findBillingProviderEventByProviderAndEventId({
      provider: "STRIPE",
      providerEventId: parsed.id,
    });
  }

  if (!row) {
    return {
      httpStatus: 500,
      body: { success: false, error: { code: "BILLING_EVENT_ROW_MISSING" } },
    };
  }

  const outcome = await processStripeEventAfterPersist(row.id, parsed);

  if (outcome.duplicate) {
    logProductEvent("stripe_webhook_duplicate", { eventId: parsed.id });
    return {
      httpStatus: 200,
      body: { success: true, data: { duplicate: true, eventId: parsed.id } },
    };
  }
  if (outcome.deferred) {
    logProductEvent("stripe_webhook_deferred", { eventId: parsed.id });
    return {
      httpStatus: 202,
      body: { success: true, data: { deferred: true, eventId: parsed.id } },
    };
  }
  if (outcome.ignored) {
    logProductEvent("stripe_webhook_ignored", {
      eventId: parsed.id,
      normalizedEventType: adapted.normalizedEventType,
    });
    return {
      httpStatus: 200,
      body: {
        success: true,
        data: {
          ignored: true,
          eventId: parsed.id,
          normalizedEventType: adapted.normalizedEventType,
        },
      },
    };
  }
  if (outcome.error) {
    logProductEvent("stripe_webhook_process_failed", { eventId: parsed.id, message: outcome.error });
    return {
      httpStatus: 500,
      body: {
        success: false,
        error: { code: "BILLING_EVENT_PROCESS_FAILED", message: outcome.error },
      },
    };
  }
  logProductEvent("stripe_webhook_processed", { eventId: parsed.id, normalizedEventType: adapted.normalizedEventType });
  return {
    httpStatus: 200,
    body: {
      success: true,
      data: { eventId: parsed.id, normalizedEventType: adapted.normalizedEventType },
    },
  };
}

export async function reprocessFailedBillingProviderEventForOps(id: string): Promise<{
  providerEventId: string;
  outcome: "reprocessed" | "duplicate" | "ignored" | "deferred";
}> {
  const row = await repo.findBillingProviderEventById(id);
  if (!row) {
    throw new AppError(404, "Billing provider event not found", { code: "NOT_FOUND" });
  }
  if (row.provider !== "STRIPE") {
    throw new AppError(400, "Only STRIPE events can be reprocessed in this slice", {
      code: "BILLING_REPROCESS_UNSUPPORTED_PROVIDER",
    });
  }
  const resetOk = await repo.resetBillingProviderEventForReprocess(id);
  if (!resetOk) {
    throw new AppError(400, "Event is not in FAILED status", { code: "BILLING_REPROCESS_NOT_FAILED" });
  }
  assertStripePayloadShape(row.payloadJson);
  const parsed = row.payloadJson as unknown as StripeWebhookEventJson;
  const outcome = await processStripeEventAfterPersist(id, parsed);
  if (outcome.duplicate) return { providerEventId: parsed.id, outcome: "duplicate" };
  if (outcome.deferred) return { providerEventId: parsed.id, outcome: "deferred" };
  if (outcome.ignored) return { providerEventId: parsed.id, outcome: "ignored" };
  if (outcome.error) {
    throw new AppError(500, outcome.error, { code: "BILLING_REPROCESS_FAILED_AGAIN" });
  }
  return { providerEventId: parsed.id, outcome: "reprocessed" };
}

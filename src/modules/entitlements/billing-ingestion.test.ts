import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { resetEnvCacheForTests } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { stripeWebhookEventToIntents } from "./adapters/stripe-billing.adapter";
import type { StripeWebhookEventJson } from "./adapters/stripe-webhook-verify";

const MIN_ENV = {
  JWT_SECRET: "j".repeat(32),
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x?sslmode=require",
  NODE_ENV: "test",
} as const;

function loadEnv(overrides: Record<string, string>): void {
  resetEnvCacheForTests();
  for (const [k, v] of Object.entries(MIN_ENV)) {
    process.env[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  resetEnvCacheForTests();
}

function signStripe(secret: string, body: Buffer): string {
  const t = Math.floor(Date.now() / 1000);
  const signed = Buffer.concat([Buffer.from(`${t}.`, "utf8"), body]);
  const hex = createHmac("sha256", secret).update(signed).digest("hex");
  return `t=${t},v1=${hex}`;
}

test("billing ingestion service", async (t) => {
  await t.test("ingestStripeWebhook 503 when STRIPE_WEBHOOK_SECRET unset", async () => {
    loadEnv({});
    delete process.env.STRIPE_WEBHOOK_SECRET;
    resetEnvCacheForTests();
    const { ingestStripeWebhook } = await import("./services/billing-provider-event.service");
    const r = await ingestStripeWebhook(Buffer.from("{}"), "t=1,v1=ab");
    assert.equal(r.httpStatus, 503);
    const body = r.body as { error?: { code?: string } };
    assert.equal(body.error?.code, "STRIPE_WEBHOOKS_DISABLED");
  });

  await t.test("ingestStripeWebhook 400 on invalid signature", async () => {
    loadEnv({ STRIPE_WEBHOOK_SECRET: "whsec_unit_test_secret_value_here" });
    const { ingestStripeWebhook } = await import("./services/billing-provider-event.service");
    const r = await ingestStripeWebhook(Buffer.from("{}"), "t=1,v1=bad");
    assert.equal(r.httpStatus, 400);
  });

  await t.test("ingestStripeWebhook 400 when Stripe event created timestamp is too old", async () => {
    const secret = "whsec_unit_test_secret_value_here";
    loadEnv({
      STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_WEBHOOK_MAX_EVENT_AGE_SEC: "120",
    });
    const { ingestStripeWebhook } = await import("./services/billing-provider-event.service");
    const oldCreated = Math.floor(Date.now() / 1000) - 600;
    const ev = {
      id: "evt_stale_1",
      type: "billing_portal.session.created",
      created: oldCreated,
      data: { object: { id: "bps_1" } },
    };
    const raw = Buffer.from(JSON.stringify(ev), "utf8");
    const sig = signStripe(secret, raw);
    const r = await ingestStripeWebhook(raw, sig);
    assert.equal(r.httpStatus, 400);
    const body = r.body as { error?: { code?: string } };
    assert.equal(body.error?.code, "STRIPE_EVENT_TOO_OLD");
  });
});

test("stripe adapter normalization", async (t) => {
  await t.test("checkout.session.completed maps to credit_purchase when metadata present", async () => {
    loadEnv({});
    const ev: StripeWebhookEventJson = {
      id: "evt_cs_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          mode: "payment",
          payment_status: "paid",
          metadata: { eduspawn_user_id: "user-credits-1", render_credits: "50" },
        },
      },
    };
    const r = stripeWebhookEventToIntents(ev);
    assert.equal(r.normalizedEventType, "credit_purchase_completed");
    assert.equal(r.intents.length, 1);
    const i = r.intents[0];
    assert.equal(i?.kind, "credit_purchase");
    if (i?.kind === "credit_purchase") {
      assert.equal(i.userId, "user-credits-1");
      assert.equal(i.credits, 50);
    }
  });

  await t.test("subscription requires eduspawn_user_id and mapped price id", async () => {
    loadEnv({
      STRIPE_PRICE_ID_PRO: "price_pro_test",
    });
    const now = Math.floor(Date.now() / 1000);
    const ev: StripeWebhookEventJson = {
      id: "evt_sub_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          current_period_start: now,
          current_period_end: now + 86400 * 30,
          metadata: { eduspawn_user_id: "user-sub-1" },
          items: { data: [{ price: { id: "price_pro_test" } }] },
        },
      },
    };
    const r = stripeWebhookEventToIntents(ev);
    assert.equal(r.intents.length, 1);
    const i = r.intents[0];
    assert.equal(i?.kind, "subscription_sync");
    if (i?.kind === "subscription_sync") {
      assert.equal(i.planTier, "PRO");
      assert.equal(i.subscriptionStatus, "ACTIVE");
    }
  });
});

test("ingest idempotency (PROCESSED)", async (t) => {
  loadEnv({ STRIPE_WEBHOOK_SECRET: "whsec_unit_test_secret_value_here" });
  const secret = "whsec_unit_test_secret_value_here";

  const payload = {
    id: "evt_idem_1",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_x",
        customer: "cus_x",
        status: "active",
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 1000,
        metadata: { eduspawn_user_id: "u1" },
        items: { data: [{ price: { id: "price_unknown" } }] },
      },
    },
  };
  const bodyBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = signStripe(secret, bodyBuf);

  type Stored = {
    id: string;
    provider: string;
    providerEventId: string;
    processingStatus: string;
    payloadJson: unknown;
  } | null;
  let stored: Stored = null;

  const bpe = prisma.billingProviderEvent as unknown as {
    findUnique: typeof prisma.billingProviderEvent.findUnique;
    create: typeof prisma.billingProviderEvent.create;
    updateMany: typeof prisma.billingProviderEvent.updateMany;
    update: typeof prisma.billingProviderEvent.update;
  };
  const origFind = bpe.findUnique.bind(bpe);
  const origCreate = bpe.create.bind(bpe);
  const origUpdateMany = bpe.updateMany.bind(bpe);
  const origUpdate = bpe.update.bind(bpe);

  function rowShape() {
    if (!stored) return null;
    return {
      id: stored.id,
      provider: "STRIPE" as const,
      providerEventId: stored.providerEventId,
      processingStatus: stored.processingStatus,
      payloadJson: stored.payloadJson,
      eventType: "customer.subscription.updated",
    };
  }

  bpe.findUnique = (async (args: {
    where: { id?: string; provider_providerEventId?: { provider: string; providerEventId: string } };
  }) => {
    if (args.where.id && stored && stored.id === args.where.id) {
      return rowShape() as never;
    }
    if (args.where.provider_providerEventId?.providerEventId === "evt_idem_1" && stored) {
      return rowShape() as never;
    }
    return null;
  }) as typeof bpe.findUnique;

  bpe.create = (async ({ data }: { data: Record<string, unknown> }) => {
    stored = {
      id: "row_idem",
      provider: "STRIPE",
      providerEventId: String(data.providerEventId),
      processingStatus: "RECEIVED",
      payloadJson: data.payloadJson,
    };
    return { id: stored.id } as never;
  }) as typeof bpe.create;

  bpe.updateMany = (async () => ({ count: 1 })) as typeof bpe.updateMany;

  bpe.update = (async ({ data }: { data: Record<string, unknown> }) => {
    if (stored) {
      if (data.processingStatus) stored.processingStatus = String(data.processingStatus);
      if (data.processedAt) stored.processingStatus = "IGNORED";
    }
    return stored as never;
  }) as typeof bpe.update;

  try {
    await t.test("second delivery short-circuits when already PROCESSED", async () => {
      stored = {
        id: "row_idem",
        provider: "STRIPE",
        providerEventId: "evt_idem_1",
        processingStatus: "PROCESSED",
        payloadJson: payload,
      };
      const { ingestStripeWebhook } = await import("./services/billing-provider-event.service");
      const r = await ingestStripeWebhook(bodyBuf, sig);
      assert.equal(r.httpStatus, 200);
      const b = r.body as { data?: { duplicate?: boolean } };
      assert.equal(b.data?.duplicate, true);
    });
  } finally {
    bpe.findUnique = origFind;
    bpe.create = origCreate;
    bpe.updateMany = origUpdateMany;
    bpe.update = origUpdate;
  }
});

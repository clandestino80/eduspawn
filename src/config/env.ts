import { z } from "zod";

function isPostgresUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "postgres:" || u.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function hasSslEnabled(databaseUrl: string): boolean {
  const lower = databaseUrl.toLowerCase();
  if (/[?&]sslmode=(require|verify-full|verify-ca)\b/.test(lower)) return true;
  if (/[?&]ssl=true\b/.test(lower)) return true;
  return false;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  /** Comma-separated allowed origins, or omit to reflect the request origin (dev-friendly). */
  CORS_ORIGIN: z.string().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().optional(),
  /**
   * Prisma reads `DATABASE_URL` for the connection pool. For AWS RDS, tune pool behavior via
   * URL query params when needed, e.g. `connection_limit`, `pool_timeout`, `connect_timeout`
   * (see Prisma docs / driver defaults), in addition to `sslmode=require`.
   */
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(isPostgresUrl, { message: "DATABASE_URL must be a postgres:// or postgresql:// URL" })
    .refine(hasSslEnabled, {
      message:
        "DATABASE_URL must enable TLS for RDS (e.g. append ?sslmode=require or use sslmode=verify-full)",
    }),
  /**
   * When false / 0 / off / no, Slice A/C/D knowledge writes are skipped (seed node, atomic extraction,
   * edge sync). Lesson JSON is unchanged. Smoke: expect `[knowledge_engine_persist_skipped]` and
   * digest counts 0 when disabled.
   */
  KNOWLEDGE_ENGINE_ENABLED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return true;
      const trimmed = val.trim();
      if (trimmed === "") return true;
      const lower = trimmed.toLowerCase();
      if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
        return false;
      }
      return true;
    }),
  /**
   * When false / 0 / off / no, Slice B personal-memory context assembly before lesson AI is skipped.
   * Does not disable persistence or extraction. Smoke: only `[knowledge_engine_generate_flags]`
   * reflects this; digest counts are unaffected by this flag alone.
   */
  KNOWLEDGE_CONTEXT_INJECTION_ENABLED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return true;
      const trimmed = val.trim();
      if (trimmed === "") return true;
      const lower = trimmed.toLowerCase();
      if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
        return false;
      }
      return true;
    }),
  /**
   * When false / 0 / off / no, Slice J global concept upsert + category link after taxonomy is skipped.
   * Personal Brain writes (category/nodes) still run; only the cross-user GlobalConcept bridge is off.
   */
  KNOWLEDGE_GLOBAL_WIKI_BRIDGE_ENABLED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return true;
      const trimmed = val.trim();
      if (trimmed === "") return true;
      const lower = trimmed.toLowerCase();
      if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
        return false;
      }
      return true;
    }),
  /**
   * When false, GlobalConceptArticle deterministic seeds are not written after GlobalConcept upsert.
   * GlobalConcept + category bridge still run; read APIs simply omit article on linked concepts.
   */
  KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return true;
      const trimmed = val.trim();
      if (trimmed === "") return true;
      const lower = trimmed.toLowerCase();
      if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
        return false;
      }
      return true;
    }),
  /**
   * When false / 0 / off / no (default), GlobalConceptArticle rows stay on deterministic_seed_v1 unless
   * enriched via explicit ops backfill. Live bridge only schedules AI enrichment on first article create when
   * both this flag and KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENABLED are true.
   */
  KNOWLEDGE_GLOBAL_CONCEPT_ARTICLE_ENRICHMENT_ENABLED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return false;
      const trimmed = val.trim();
      if (trimmed === "") return false;
      const lower = trimmed.toLowerCase();
      if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") {
        return true;
      }
      return false;
    }),
  /**
   * Comma-separated JWT `sub` values allowed to call knowledge-engine ops routes (e.g. concept enrich).
   * Whitespace trimmed; empty or omitted means no user-id matches (use emails or leave all ops denied).
   */
  KNOWLEDGE_OPS_ALLOWED_USER_IDS: z.string().optional(),
  /**
   * Comma-separated emails allowed for knowledge-engine ops routes; matched case-insensitively to JWT email.
   * Empty or omitted means no email matches. When both ID and email lists are empty, all ops requests are denied.
   */
  KNOWLEDGE_OPS_ALLOWED_EMAILS: z.string().optional(),
  /**
   * Comma-separated JWT `sub` values allowed to call billing/entitlement ops routes.
   * Empty with emails empty → deny all (set explicitly for staging/prod operators).
   */
  BILLING_OPS_ALLOWED_USER_IDS: z.string().optional(),
  /** Comma-separated emails for billing ops; matched case-insensitively to JWT email. */
  BILLING_OPS_ALLOWED_EMAILS: z.string().optional(),
  /**
   * Slice D — when false, daily fresh-generation checks are skipped (ops / migration escape hatch).
   * Does not affect read-only routes (e.g. topic feed).
   */
  ENTITLEMENT_ENFORCEMENT_ENABLED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return true;
      const trimmed = val.trim();
      if (trimmed === "") return true;
      const lower = trimmed.toLowerCase();
      if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
        return false;
      }
      return true;
    }),
  /** Default plan tier when no per-user subscription row exists yet. */
  ENTITLEMENT_DEFAULT_PLAN_TIER: z.enum(["free", "pro", "premium"]).default("free"),
  /** Legacy alias read by older code paths; optional override of default tier. */
  DEFAULT_PLAN_TIER: z.enum(["free", "pro", "premium"]).optional(),
  /** Comma-separated user ids treated as Pro for entitlement limits (staging / pilot). */
  ENTITLEMENT_PRO_USER_IDS: z.string().optional(),
  /**
   * Free tier: max new **learning starts** per UTC day (lesson generate + free creator generate share this bucket).
   * Product-facing allowance (not framed as token spend).
   */
  FREE_DAILY_LEARNING_START_LIMIT: z.coerce.number().int().nonnegative().default(5),
  /**
   * Legacy env key: daily cap for the `freshGenerationsUsed` meter on **free** tier (mostly superseded by
   * `FREE_DAILY_LEARNING_START_LIMIT` for lesson starts; Pro/Premium still use `freshGenerationsUsed` for lessons).
   */
  FREE_DAILY_FRESH_GENERATION_LIMIT: z.coerce.number().int().nonnegative().default(5),
  PRO_DAILY_FRESH_GENERATION_LIMIT: z.coerce.number().int().nonnegative().default(40),
  PREMIUM_DAILY_FRESH_GENERATION_LIMIT: z.coerce.number().int().nonnegative().default(120),
  /** Pro: monthly creator capacity in minutes (default 600 = 10h). */
  PRO_MONTHLY_CREATOR_MINUTES_LIMIT: z.coerce.number().int().nonnegative().default(600),
  PREMIUM_MONTHLY_CREATOR_MINUTES_LIMIT: z.coerce.number().int().nonnegative().default(1200),
  /**
   * When creator output is served from `GlobalCreatorMemory`, bill this % fewer minutes than a fresh run
   * (e.g. 50 → pay half, rounded up, minimum 1 minute whenever a debit applies).
   */
  CREATOR_REUSE_MINUTE_DISCOUNT_PERCENT: z.coerce.number().int().min(0).max(95).default(50),
  /** Granted once when a Pro-tier wallet row is first created (0 = disabled). */
  PRO_STARTER_RENDER_CREDITS: z.coerce.number().int().nonnegative().default(0),
  /**
   * When true and a render action has a positive credit cost, balance must cover it.
   * Heavy render routes opt in per cost env (e.g. longform).
   */
  RENDER_CREDITS_REQUIRED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return false;
      const trimmed = val.trim();
      if (trimmed === "") return false;
      const lower = trimmed.toLowerCase();
      if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") {
        return true;
      }
      return false;
    }),
  /** Credits debited for one long-form video script generation when enforcement + wallet path run. */
  RENDER_LONGFORM_CREDIT_COST: z.coerce.number().int().nonnegative().default(0),
  /** Credits debited when starting a render job from a short-form creator pack (minimum 1). */
  RENDER_CREATOR_PACK_SHORT_CREDIT_COST: z.coerce.number().int().positive().default(1),
  /** Credits debited when starting a render job from a long-form creator pack (minimum 1). */
  RENDER_CREATOR_PACK_LONG_CREDIT_COST: z.coerce.number().int().positive().default(2),
  /**
   * Default render provider for new jobs. `KLING_STUB` is a non-network adapter for pipeline wiring;
   * set `RENDER_KLING_STUB_MODE=submit_ok` in dev to exercise success paths without Kling credentials.
   */
  RENDER_DEFAULT_PROVIDER: z.enum(["KLING_STUB", "KLING"]).default("KLING_STUB"),
  /**
   * Stub adapter behavior: `submit_fail` (default, safe) refunds after a simulated provider rejection;
   * `submit_ok` accepts the job so refresh/webhook can complete a dry-run pipeline.
   */
  RENDER_KLING_STUB_MODE: z.enum(["submit_fail", "submit_ok"]).default("submit_fail"),
  /** Shared secret for `POST /api/v1/render/webhooks/provider` (timing-safe compare). When unset, webhook returns 503. */
  RENDER_WEBHOOK_SECRET: z.string().min(8).optional(),
  /** Optional Kling (or compatible) HTTP API key — real adapter refuses submit when missing. */
  RENDER_KLING_API_KEY: z.string().optional(),
  /**
   * Base URL for Kling HTTP API. When unset but `RENDER_KLING_API_KEY` is set, the adapter uses the official
   * `https://api.klingapi.com` default from https://klingapi.com/docs
   */
  RENDER_KLING_API_BASE_URL: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return t && t.length > 0 ? t : undefined;
    })
    .refine((s) => s === undefined || /^https?:\/\/.+/i.test(s), {
      message: "RENDER_KLING_API_BASE_URL must be http(s) when set",
    }),
  /** Model id for POST /v1/videos/text2video (see Kling docs). */
  RENDER_KLING_MODEL: z.string().min(1).max(64).default("kling-v2.6-pro"),
  /**
   * Optional callback URL forwarded as `callback_url` on task creation (field name per common Kling SDK usage).
   * Must be the full public URL of `POST /api/v1/render/webhooks/provider` (or a proxy) when used.
   */
  RENDER_KLING_CALLBACK_URL: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return t && t.length > 0 ? t : undefined;
    })
    .refine((s) => s === undefined || /^https?:\/\/.+/i.test(s), {
      message: "RENDER_KLING_CALLBACK_URL must be http(s) when set",
    }),
  RENDER_KLING_DEFAULT_ASPECT_RATIO: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  /** Optional `mode` field (`standard` | `professional`) per Kling docs. */
  RENDER_KLING_DEFAULT_MODE: z.enum(["standard", "professional"]).optional(),
  /** Optional `negative_prompt` forwarded on submit (truncated server-side). */
  RENDER_KLING_NEGATIVE_PROMPT: z.string().max(500).optional(),
  /**
   * When > 0 and inbound webhooks include `X-Webhook-Timestamp`, reject if skew exceeds this many seconds.
   * Not specified by klingapi.com public docs; defense-in-depth for compatible proxies. Set 0 to disable.
   */
  RENDER_WEBHOOK_MAX_CLOCK_SKEW_SEC: z.coerce.number().int().min(0).max(3600).default(600),
  /**
   * Slice E — in-process topic feed response cache (per Node process). When false, every GET /topics/feed
   * runs the full read path (still unmetered). Safe default: off until explicitly enabled in prod.
   */
  TOPIC_FEED_CACHE_ENABLED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return false;
      const trimmed = val.trim();
      if (trimmed === "") return false;
      const lower = trimmed.toLowerCase();
      if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") {
        return true;
      }
      return false;
    }),
  /** TTL for cached topic feed payloads (seconds). Clamped 5–600 when cache is enabled. */
  TOPIC_FEED_CACHE_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(45),
  /**
   * Stripe webhook signing secret (`whsec_...`). When unset, POST /billing/webhooks/stripe returns 503
   * (webhooks disabled — avoids accepting unsigned bodies in production by accident).
   */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Map Stripe Price id → Pro tier for subscription webhooks (optional until Stripe is wired). */
  STRIPE_PRICE_ID_PRO: z.string().optional(),
  /** Map Stripe Price id → Premium tier for subscription webhooks (optional). */
  STRIPE_PRICE_ID_PREMIUM: z.string().optional(),
  /** Secret API key for Stripe Checkout session creation (`sk_...`). Optional until checkout is enabled. */
  STRIPE_SECRET_KEY: z.string().optional(),
  /** One-time credit pack prices (payment mode Checkout). */
  STRIPE_PRICE_ID_RENDER_CREDITS_SMALL: z.string().optional(),
  STRIPE_PRICE_ID_RENDER_CREDITS_MEDIUM: z.string().optional(),
  STRIPE_PRICE_ID_RENDER_CREDITS_LARGE: z.string().optional(),
  /** Redirect URLs for Checkout (may include `{CHECKOUT_SESSION_ID}` in success URL per Stripe). */
  STRIPE_CHECKOUT_SUCCESS_URL: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return t && t.length > 0 ? t : undefined;
    })
    .refine((s) => s === undefined || /^https?:\/\/.+/i.test(s), {
      message: "STRIPE_CHECKOUT_SUCCESS_URL must be a valid http(s) URL when set",
    }),
  STRIPE_CHECKOUT_CANCEL_URL: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return t && t.length > 0 ? t : undefined;
    })
    .refine((s) => s === undefined || /^https?:\/\/.+/i.test(s), {
      message: "STRIPE_CHECKOUT_CANCEL_URL must be a valid http(s) URL when set",
    }),
  /**
   * When true, after a fresh creator generation the system original may be upserted into `GlobalCreatorMemory`.
   * Default off: avoids automatic global promotion until product ops enable it.
   */
  CREATOR_GLOBAL_MEMORY_AUTO_PROMOTE: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return false;
      const trimmed = val.trim();
      if (trimmed === "") return false;
      const lower = trimmed.toLowerCase();
      return lower === "true" || lower === "1" || lower === "yes" || lower === "on";
    }),
  /** When false, creator generation always runs fresh AI (still metered); disables global reuse lookup. */
  CREATOR_REUSE_ENABLED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return true;
      const trimmed = val.trim();
      if (trimmed === "") return true;
      const lower = trimmed.toLowerCase();
      if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
        return false;
      }
      return true;
    }),
  /** Max `durationSec` for free-tier short creator packs (first-class duration constraint). */
  FREE_CREATOR_MAX_DURATION_SEC: z.coerce.number().int().positive().max(600).default(90),

  /**
   * When > 0, Express `trust proxy` is set for accurate req.ip / rate limits behind a reverse proxy.
   * Typical production value: 1. Use 0 (default) when the app is reached directly.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(32).default(0),

  /**
   * Master switch for HTTP rate limiting on expensive routes. When false, route limiters are skipped
   * (abuse controls in services still apply unless individually disabled via max=0).
   */
  RATE_LIMITING_ENABLED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return true;
      const lower = val.trim().toLowerCase();
      if (lower === "false" || lower === "0" || lower === "no" || lower === "off") return false;
      return true;
    }),

  /** POST /core/sessions/:id/generate — max requests per user per window. 0 = unlimited. */
  RATE_LIMIT_CORE_LESSON_MAX: z.coerce.number().int().min(0).max(10_000).default(30),
  RATE_LIMIT_CORE_LESSON_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),

  RATE_LIMIT_CORE_LONGFORM_MAX: z.coerce.number().int().min(0).max(10_000).default(20),
  RATE_LIMIT_CORE_LONGFORM_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),

  RATE_LIMIT_CREATOR_GENERATE_MAX: z.coerce.number().int().min(0).max(10_000).default(20),
  RATE_LIMIT_CREATOR_GENERATE_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),

  RATE_LIMIT_RENDER_JOB_MAX: z.coerce.number().int().min(0).max(10_000).default(25),
  RATE_LIMIT_RENDER_JOB_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),

  RATE_LIMIT_RENDER_REFRESH_MAX: z.coerce.number().int().min(0).max(10_000).default(120),
  RATE_LIMIT_RENDER_REFRESH_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),

  RATE_LIMIT_BILLING_CHECKOUT_MAX: z.coerce.number().int().min(0).max(10_000).default(15),
  RATE_LIMIT_BILLING_CHECKOUT_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),

  /** Per-IP limit for POST /billing/webhooks/stripe. 0 = disabled (Stripe egress IPs vary). */
  RATE_LIMIT_STRIPE_WEBHOOK_IP_MAX: z.coerce.number().int().min(0).max(1_000_000).default(0),
  RATE_LIMIT_STRIPE_WEBHOOK_IP_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),

  /** Per-IP limit for POST /render/webhooks/provider (shared secret still required). 0 = disabled. */
  RATE_LIMIT_RENDER_WEBHOOK_IP_MAX: z.coerce.number().int().min(0).max(1_000_000).default(120),
  RATE_LIMIT_RENDER_WEBHOOK_IP_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),

  /** Max non-terminal render jobs per user (QUEUED/SUBMITTED/PROCESSING). 0 = disable check. */
  RENDER_ABUSE_MAX_ACTIVE_JOBS_PER_USER: z.coerce.number().int().min(0).max(500).default(8),
  /** Max concurrent in-flight renders per creator pack for a user. 0 = disable check. */
  RENDER_ABUSE_MAX_ACTIVE_JOBS_PER_PACK: z.coerce.number().int().min(0).max(50).default(1),

  /** Count UserCreatorPack rows created in rolling window; generation burst guard. 0 = disabled. */
  CREATOR_ABUSE_MAX_PACKS_PER_WINDOW: z.coerce.number().int().min(0).max(10_000).default(40),
  CREATOR_ABUSE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),

  /**
   * Reject Stripe webhook events whose `created` timestamp is older than this many seconds.
   * 0 = disabled (signature timestamp still enforced in verifyStripeWebhookBuffer).
   */
  STRIPE_WEBHOOK_MAX_EVENT_AGE_SEC: z.coerce.number().int().min(0).max(7 * 24 * 3600).default(86_400),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    const detail = JSON.stringify(msg, null, 2);
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  cached = parsed.data;
  return cached;
}

export function getEnv(): Env {
  return loadEnv();
}

/**
 * Clears the env singleton so the next `loadEnv()` re-reads `process.env`.
 * Intended for automated tests only; do not use in production request paths.
 */
export function resetEnvCacheForTests(): void {
  cached = null;
}

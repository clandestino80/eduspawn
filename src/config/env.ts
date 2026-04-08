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
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(isPostgresUrl, { message: "DATABASE_URL must be a postgres:// or postgresql:// URL" })
    .refine(hasSslEnabled, {
      message:
        "DATABASE_URL must enable TLS for RDS (e.g. append ?sslmode=require or use sslmode=verify-full)",
    }),
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

/**
 * Boot-time environment validation (fail-fast).
 *
 * The app must refuse to start if any required secret is missing, so we never
 * ship a build that silently degrades auth or tenant isolation. Every variable
 * here is a real, team-provisioned secret — nothing is defaulted or invented.
 *
 * These names mirror the Stage 0 env checklist in the execution plan. If you
 * add a variable, add it to `.env.example` and to the Vercel project too.
 */
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    // --- Database (existing Supabase project, schema `spark_tasks`) ---
    DATABASE_URL: z.string().url(),
    // Not used by runtime code (we talk to Postgres directly via DATABASE_URL);
    // kept optional in case ops tooling needs it later.
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

    // --- GHL agency app (OAuth + SSO) ---
    GHL_APP_CLIENT_ID: z.string().min(1),
    GHL_APP_CLIENT_SECRET: z.string().min(1),
    /** Agency "Shared Secret Key" used to decrypt the iframe SSO payload. */
    GHL_SSO_KEY: z.string().min(1),
    /**
     * Agency/company id. Optional: the OAuth callback captures companyId from
     * the token response; set this only to pin a specific agency.
     */
    GHL_COMPANY_ID: z.string().min(1).optional(),

    // --- Crypto / sessions ---
    /** base64 of 32 random bytes — AES-256-GCM key for tokens at rest. */
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, {
        message: "ENCRYPTION_KEY must be base64 of exactly 32 bytes",
      }),
    /** Secret for signing the httpOnly session cookie. */
    SESSION_SECRET: z.string().min(32),

    // --- Background jobs ---
    // Optional until the team provisions the Trigger.dev project (Stage 0
    // blocker). The completion write-back currently runs via Next `after()`
    // with retries; when this key exists we move it onto Trigger.dev and make
    // this required again.
    TRIGGER_SECRET_KEY: z.string().min(1).optional(),
    /** Tag added to the GHL contact on task completion (D7). */
    GHL_WRITEBACK_TAG: z.string().min(1).optional(),

    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },
  // No client vars in V1: location_id and all identity live server-side only.
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GHL_APP_CLIENT_ID: process.env.GHL_APP_CLIENT_ID,
    GHL_APP_CLIENT_SECRET: process.env.GHL_APP_CLIENT_SECRET,
    GHL_SSO_KEY: process.env.GHL_SSO_KEY,
    GHL_COMPANY_ID: process.env.GHL_COMPANY_ID,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    SESSION_SECRET: process.env.SESSION_SECRET,
    TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
    GHL_WRITEBACK_TAG: process.env.GHL_WRITEBACK_TAG,
    NODE_ENV: process.env.NODE_ENV,
  },
  emptyStringAsUndefined: true,
  // Allow `next lint`/typecheck without secrets present in CI.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});

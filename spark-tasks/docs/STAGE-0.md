# Stage 0 — status & blockers

This file tracks what is done and what is required from the team before the
build can proceed. Per the execution plan (§2 rule 5, §12), auth was **not**
scaffolded around missing credentials — the items below are genuine blockers,
not things to stub.

## Done (🤖, no secrets required)

- [x] Repo scaffold: Next.js 15 + TS strict + tRPC deps + Drizzle + env validation.
- [x] Fail-fast env validation (`src/env.ts`) declaring every required secret.
- [x] Drizzle schema for `spark_tasks` (`src/server/db/schema.ts`) — boards,
      tasks, task_assignees; matches plan §5.
- [x] Authoritative migration `drizzle/0000_init.sql`: schema, tables, indexes,
      RLS **enabled + forced**, `tenant_isolation` policies, and a non-superuser
      `spark_tasks_app` role.
- [x] RLS isolation smoke test `drizzle/verify_rls.sql`.
- [x] CSP `frame-ancestors` for GHL domains (`next.config.mjs`).

## Blocked — needed from the team (👤) before Stage 1

These map to the Stage 0 blockers in the plan. Nothing downstream can start
until they exist; the environment currently has **none** of them.

### GHL agency app (OAuth + SSO)
- [ ] Create the **agency-level GHL app** (OAuth, agency/company distribution)
      in the GHL Developer Portal.
- [ ] Grant scopes: `locations.readonly`, `users.readonly`, `contacts.readonly`,
      **`contacts.write`** (D7 write-back), plus OAuth + `oauth/locationToken`.
      → Missing `users.readonly` blocks Stage 3 (assign). Missing `contacts.*`
        blocks Stage 4 (link + write-back). Flag, don't work around.
- [ ] Complete the **agency OAuth install** to capture the Company access +
      refresh token (or provide the install redirect so the app captures them).
- [ ] Provide `GHL_APP_CLIENT_ID`, `GHL_APP_CLIENT_SECRET`, `GHL_SSO_KEY`
      (agency Shared Secret Key), `GHL_COMPANY_ID`.
- [ ] Register the iframe URL in the GHL app/location settings.

### Database / secrets
- [ ] Confirm `DATABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for the existing
      Supabase project, and **which** project (reuse per D2).
- [ ] `ENCRYPTION_KEY` — base64 of 32 bytes
      (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
- [ ] `SESSION_SECRET` — ≥32 chars.
- [ ] `TRIGGER_SECRET_KEY` from the Trigger.dev project.
- [ ] Add all of the above to the new Vercel project's env.

### Migration apply (🤝)
- [ ] Apply `drizzle/0000_init.sql` to the existing Supabase project.
- [ ] Run `drizzle/verify_rls.sql`; confirm `OK read-isolation` +
      `OK write-isolation`. Paste results here.

## Reusable prior art (from `spark-referral-hub`, same repo)

The existing SparkLeads project already implements the exact GHL patterns this
build needs — reuse them in Stage 1 rather than reinventing:

- `lib/server/ghl-decrypt.js` — decrypts the GHL iframe SSO payload
  (crypto-js AES-256-CBC / `Salted__` format) with the agency Shared Secret
  Key. This is the `GHL_SSO_KEY` decryption for `/api/sso/handshake`.
- `lib/server/crypto.js` — AES-256-GCM encrypt/decrypt for tokens at rest
  (`iv || ct || tag`, base64). Same shape as `ENCRYPTION_KEY` here.
- `lib/server/ghl-token.js` — OAuth token refresh + location resolution;
  adapt for the agency-token → `POST /oauth/locationToken` exchange (§4.2).

## Design note surfaced during Stage 0 (not a re-litigation)

`SUPABASE_SERVICE_ROLE_KEY` and a superuser `DATABASE_URL` both **bypass RLS**.
For RLS to be the promised backstop, the app connects to Postgres and then
`SET LOCAL role spark_tasks_app` (non-superuser, no BYPASSRLS) per request
before setting `app.location_id`. The migration creates that role. Confirm the
`DATABASE_URL` role is allowed to `SET ROLE spark_tasks_app` (any superuser or a
role granted membership can). This is implementation guidance, not a scope
change — flagged here so it isn't lost.

## Gate 0 (all must pass to proceed)

- [ ] 👤 Agency app created, OAuth installed, scopes granted.
- [ ] 👤 All env vars present in Vercel.
- [x] 🤖 Repo scaffolds. (Local boot pending `pnpm install` + secrets.)
- [ ] 🤝 Migration applied; RLS confirmed via `verify_rls.sql`.

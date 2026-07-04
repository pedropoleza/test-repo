# Spark Tasks

A standalone, multi-tenant task-management module for the SparkLeads suite,
rendered as an **iframe embedded inside GoHighLevel (GHL) locations**. One
deployment serves many locations; data is strictly isolated per location.

> **Status: Stage 0 (scaffold) complete. Stages 1–5 are blocked on team
> actions — see [`docs/STAGE-0.md`](docs/STAGE-0.md).** No authentication code
> has been built against invented credentials; the auth foundation (Stage 1)
> starts once the GHL agency app and secrets are provisioned.

## Stack

- Next.js 15 (App Router) · TypeScript strict
- tRPC (type-safe API) · REST only for SSO handshake + healthcheck
- Drizzle ORM · Postgres schema `spark_tasks` on the existing Supabase project
- Trigger.dev for the contact write-back job
- Vercel hosting · pnpm

## Layout

```
src/
  env.ts                     boot-time env validation (fail-fast)
  server/
    db/schema.ts             Drizzle schema (schema: spark_tasks)
    db/index.ts              Postgres client
    api/routers/*            tRPC routers            (Stage 2+)
    ghl/*                    GHL OAuth + location token + API client (Stage 1+)
    auth/*                   SSO handshake + session (Stage 1)
  app/*                      iframe UI (App Router)
  components/board/*         board + card UI          (Stage 2)
drizzle/
  0000_init.sql             authoritative migration: tables + RLS + app role
  verify_rls.sql            tenant-isolation smoke test (Stage 0 gate)
```

## Tenant isolation (the core invariant)

1. `location_id` is **never** accepted from the client — it is derived
   server-side from the validated SSO session and injected into every query.
2. **RLS is the backstop.** Every table has RLS enabled *and forced*. Each
   request runs in a transaction that does
   `SET LOCAL role spark_tasks_app` + `SET LOCAL app.location_id = <session>`,
   and every policy checks `location_id = current_setting('app.location_id')`.
   Running under a non-superuser role is what makes RLS real — a superuser (or
   Supabase `service_role`) would bypass policies silently.
3. Isolation is proven by `drizzle/verify_rls.sql` (and, in Stage 1, an
   automated test) **before** any task UI is built.

## Getting started (once Stage 0 blockers are cleared)

```bash
pnpm install
cp .env.example .env.local   # fill in real secrets (see docs/STAGE-0.md)
# apply the migration to the existing Supabase project:
psql "$DATABASE_URL" -f drizzle/0000_init.sql
psql "$DATABASE_URL" -f drizzle/verify_rls.sql   # expect: OK read/write-isolation
pnpm dev
```

The app fails fast at boot if any required env var is missing.

## Scope

V1 scope is frozen to the execution plan. Anything not in it (multiple boards,
custom columns, free-form colors, comments, attachments, subtasks,
notifications, alternate views, granular roles) is **V2**.

-- 0001_init.sql
-- Spark Referral Hub — schema inicial (V1).
-- Pré-requisitos: extensão pgcrypto (gen_random_uuid) habilitada.
-- Executar contra o banco do Supabase configurado em DATABASE_URL.

create extension if not exists pgcrypto;

-- =========================================================================
-- installations
-- Mapeia uma sub-account do GHL conectada ao Spark Referral Hub. Guarda os
-- tokens OAuth criptografados em repouso (AES-256-GCM com TOKEN_ENCRYPTION_KEY)
-- e o cupom Stripe associado àquela location.
-- =========================================================================
create table if not exists installations (
  location_id           text primary key,
  location_name         text,
  access_token          text not null,                  -- AES-256-GCM (base64)
  refresh_token         text not null,                  -- AES-256-GCM (base64)
  expires_at            timestamptz not null,
  scope                 text,
  coupon_code           text unique,
  stripe_promotion_id   text,
  status                text not null default 'active'
                          check (status in ('active', 'suspended', 'uninstalled')),
  installed_at          timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_installations_status on installations(status);

-- =========================================================================
-- referrals
-- Uma linha por indicação. Estado canônico do programa.
-- (Ver D3: estado canônico vive aqui, GHL fica apenas como source de evento.)
-- =========================================================================
create table if not exists referrals (
  id                       uuid primary key default gen_random_uuid(),
  indicador_location       text not null
                             references installations(location_id) on delete cascade,
  indicado_location        text,
  indicado_email           text,
  coupon_used              text,
  status                   text not null default 'pending'
                             check (status in (
                               'pending', 'paid', 'qualified',
                               'refunded', 'fraud', 'canceled'
                             )),
  subaccount_created_at    timestamptz,
  first_payment_at         timestamptz,
  qualified_at             timestamptz,
  disqualified_at          timestamptz,
  disqualification_reason  text,
  stripe_customer_id       text,
  stripe_subscription_id   text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_referrals_indicador
  on referrals(indicador_location);
create index if not exists idx_referrals_status
  on referrals(status);
create index if not exists idx_referrals_pending_qualification
  on referrals(first_payment_at)
  where status = 'paid';
create unique index if not exists uq_referrals_indicado_location
  on referrals(indicado_location)
  where indicado_location is not null;

-- =========================================================================
-- ghl_events  /  stripe_events
-- Idempotência de webhooks. event_id é a chave única do provider — segunda
-- chegada do mesmo evento é detectada e ignorada.
-- =========================================================================
create table if not exists ghl_events (
  event_id     text primary key,
  type         text not null,
  payload      jsonb not null,
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ghl_events_type on ghl_events(type);
create index if not exists idx_ghl_events_pending on ghl_events(created_at)
  where processed_at is null;

create table if not exists stripe_events (
  event_id     text primary key,
  type         text not null,
  payload      jsonb not null,
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_stripe_events_type on stripe_events(type);
create index if not exists idx_stripe_events_pending on stripe_events(created_at)
  where processed_at is null;

-- =========================================================================
-- updated_at trigger
-- =========================================================================
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_installations_updated on installations;
create trigger trg_installations_updated before update on installations
  for each row execute function set_updated_at();

drop trigger if exists trg_referrals_updated on referrals;
create trigger trg_referrals_updated before update on referrals
  for each row execute function set_updated_at();

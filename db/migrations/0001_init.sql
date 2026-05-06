-- 0001_init.sql
-- Spark Referral Hub — schema inicial (V1).
-- Pré-requisitos: extensão pgcrypto (gen_random_uuid) habilitada (default no Supabase).
-- Aplicado em projeto dedicado: spark-referral-hub.
--
-- Eventos de webhook GHL e Stripe NÃO ganham tabela própria — quando integrarmos
-- com o Sparkleads OS para reuso, podemos espelhar a tabela `webhook_events`
-- existente lá. Por enquanto este projeto fica isolado.

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
  stripe_coupon_id      text,
  stripe_promotion_id   text,
  stripe_customer_id    text,                           -- preenchido quando mapeado
  status                text not null default 'active'
                          check (status in ('active', 'suspended', 'uninstalled')),
  installed_at          timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_installations_status on installations(status);
create index if not exists idx_installations_stripe_customer
  on installations(stripe_customer_id);

-- =========================================================================
-- referrals
-- Estado canônico do programa. Uma linha por indicação.
-- (Ver D3: estado canônico vive aqui, GHL/Stripe são apenas fontes de evento.)
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
create index if not exists idx_referrals_paid_pending
  on referrals(first_payment_at)
  where status = 'paid';
create unique index if not exists uq_referrals_indicado_location
  on referrals(indicado_location)
  where indicado_location is not null;

-- =========================================================================
-- webhook_events
-- Idempotência + auditoria de eventos vindos de GHL e Stripe.
-- Inspirado no shape do Sparkleads OS para coerência futura.
-- =========================================================================
create table if not exists webhook_events (
  event_id        text not null,
  source          text not null check (source in ('ghl', 'stripe')),
  event_type      text,
  payload         jsonb not null,
  headers         jsonb,
  signature_valid boolean,
  processed       boolean not null default false,
  processed_at    timestamptz,
  received_at     timestamptz not null default now(),
  primary key (source, event_id)
);
create index if not exists idx_webhook_events_pending
  on webhook_events(received_at)
  where processed = false;
create index if not exists idx_webhook_events_type
  on webhook_events(source, event_type);

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

-- =========================================================================
-- RLS
-- Tudo bloqueado por padrão. Acesso vem das API routes via service_role,
-- nunca direto do browser.
-- =========================================================================
alter table installations enable row level security;
alter table referrals enable row level security;
alter table webhook_events enable row level security;

-- Policy de "negar tudo" implícita: sem policies = nada passa via anon/authenticated.
-- Service role bypassa RLS por padrão.

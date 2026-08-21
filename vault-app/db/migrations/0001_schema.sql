-- 0002_document_vault.sql
-- Spark Document Vault (Cofre de Documentos) — schema V1.
--
-- Espelha todo documento salvo na nuvem do contato no GHL ("Add to documents")
-- para storage próprio da Spark, organizado por contato + serviço + tipo, com
-- checklist de pendências ("o que falta").
--
-- SEPARAÇÃO: mora num SCHEMA dedicado `document_vault`, isolado do Referral Hub
-- e dos demais apps. Self-contained — não depende de objetos de outras migrations
-- (traz a própria função set_updated_at e o próprio audit_log). O nome `vault`
-- é reservado pela extensão Supabase Vault, por isso `document_vault`.
--
-- Aplicado no projeto Supabase: Sparkleads OS (nsqwgjbgcdqyzozyaltz).

create extension if not exists pgcrypto;
create schema if not exists document_vault;

-- =========================================================================
-- Função de updated_at (própria do schema — não reusa a do Referral)
-- =========================================================================
create or replace function document_vault.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- installations
-- Tokens OAuth do app do Cofre, POR LOCATION. App GHL distinto — não reusa
-- `installations` do Referral. Tokens criptografados em repouso
-- (AES-256-GCM com a chave do Cofre).
-- =========================================================================
create table if not exists document_vault.installations (
  location_id    text primary key,
  location_name  text,
  company_id     text,
  access_token   text not null,   -- AES-256-GCM (base64)
  refresh_token  text not null,   -- AES-256-GCM (base64)
  expires_at     timestamptz not null,
  scope          text,
  status         text not null default 'active'
                   check (status in ('active', 'suspended', 'uninstalled')),
  installed_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_dv_installations_status
  on document_vault.installations(status);

-- =========================================================================
-- webhook_events — idempotência + auditoria dos webhooks do app do Cofre
-- =========================================================================
create table if not exists document_vault.webhook_events (
  event_id        text primary key,
  event_type      text,
  payload         jsonb not null,
  headers         jsonb,
  signature_valid boolean,
  processed       boolean not null default false,
  processed_at    timestamptz,
  received_at     timestamptz not null default now()
);
create index if not exists idx_dv_webhook_events_pending
  on document_vault.webhook_events(received_at) where processed = false;

-- =========================================================================
-- services — catálogo de serviços (seed global com location_id NULL; uma
-- location pode sobrescrever/estender). Raiz da taxonomia.
-- =========================================================================
create table if not exists document_vault.services (
  id            uuid primary key default gen_random_uuid(),
  location_id   text references document_vault.installations(location_id) on delete cascade,
  service_key   text not null,
  name_pt       text not null,
  name_en       text not null,
  sort          int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_dv_services_key
  on document_vault.services (coalesce(location_id, '*'), service_key);

-- =========================================================================
-- doc_types — o "doc_checklist_template": tipos esperados por serviço.
-- =========================================================================
create table if not exists document_vault.doc_types (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null references document_vault.services(id) on delete cascade,
  doc_key       text not null,
  label_pt      text not null,
  label_en      text not null,
  required      boolean not null default true,
  sort          int  not null default 0,
  created_at    timestamptz not null default now(),
  unique (service_id, doc_key)
);

-- =========================================================================
-- documents — um registro por documento espelhado. contact_id pode nascer
-- NULL (media sem dono resolvido). NUNCA guardar a URL do GHL em claro.
-- =========================================================================
create table if not exists document_vault.documents (
  id                 uuid primary key default gen_random_uuid(),
  location_id        text not null references document_vault.installations(location_id) on delete cascade,
  contact_id         text,
  contact_name       text,
  service_key        text,
  doc_key            text,
  source             text not null
                       check (source in ('media', 'conversation', 'form')),
  source_ref         text not null,        -- mediaId | messageId | customFieldId → idempotência
  contact_resolution text not null default 'unresolved'
                       check (contact_resolution in (
                         'media_native', 'conversation_fallback',
                         'form_native', 'manual', 'unresolved'
                       )),
  ghl_url_enc        text,                 -- URL original no GHL, AES-256-GCM (base64). Nunca em claro.
  storage_key        text,                 -- caminho no bucket seguro da Spark
  filename           text,
  mime               text,
  size_bytes         bigint,
  checksum           text,                 -- sha256 do conteúdo (dedup)
  status             text not null default 'pending'
                       check (status in ('pending', 'mirrored', 'failed', 'quarantined')),
  captured_at        timestamptz not null default now(),
  created_at_ghl     timestamptz,
  mirrored_at        timestamptz,
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (location_id, source, source_ref)
);
create index if not exists idx_dv_documents_contact
  on document_vault.documents(location_id, contact_id);
create index if not exists idx_dv_documents_service
  on document_vault.documents(location_id, service_key);
create index if not exists idx_dv_documents_pending
  on document_vault.documents(captured_at)
  where status in ('pending', 'failed');
create index if not exists idx_dv_documents_checksum
  on document_vault.documents(location_id, checksum)
  where checksum is not null;

-- =========================================================================
-- sync_state — cursor do poll incremental, por location + fonte.
-- =========================================================================
create table if not exists document_vault.sync_state (
  location_id   text not null references document_vault.installations(location_id) on delete cascade,
  source        text not null
                  check (source in ('media', 'conversation', 'form')),
  last_cursor   text,
  last_run_at   timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (location_id, source)
);

-- =========================================================================
-- access_grants — acesso por departamento, espelhando permissões do GHL.
-- Fonte da verdade das permissões: decisão pendente (docs → D4).
-- =========================================================================
create table if not exists document_vault.access_grants (
  id            uuid primary key default gen_random_uuid(),
  location_id   text not null references document_vault.installations(location_id) on delete cascade,
  ghl_user_id   text,
  department    text,
  scope         text not null default 'department'
                  check (scope in ('all', 'department', 'contact')),
  contact_id    text,
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_dv_access_grants
  on document_vault.access_grants (
    location_id, coalesce(ghl_user_id, ''), coalesce(department, ''), coalesce(contact_id, '')
  );

-- =========================================================================
-- audit_log — auditoria de TODO acesso/download (dado sensível de imigrante).
-- Próprio do Cofre (não reusa o audit_log de outro app).
-- =========================================================================
create table if not exists document_vault.audit_log (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null,          -- vault.document.viewed | .downloaded | ...
  actor         text not null default 'system',
  location_id   text,
  document_id   uuid,
  summary       text,
  data          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_dv_audit_document
  on document_vault.audit_log(document_id);
create index if not exists idx_dv_audit_created
  on document_vault.audit_log(created_at);

-- =========================================================================
-- updated_at triggers
-- =========================================================================
drop trigger if exists trg_dv_installations_updated on document_vault.installations;
create trigger trg_dv_installations_updated before update on document_vault.installations
  for each row execute function document_vault.set_updated_at();

drop trigger if exists trg_dv_services_updated on document_vault.services;
create trigger trg_dv_services_updated before update on document_vault.services
  for each row execute function document_vault.set_updated_at();

drop trigger if exists trg_dv_documents_updated on document_vault.documents;
create trigger trg_dv_documents_updated before update on document_vault.documents
  for each row execute function document_vault.set_updated_at();

drop trigger if exists trg_dv_sync_state_updated on document_vault.sync_state;
create trigger trg_dv_sync_state_updated before update on document_vault.sync_state
  for each row execute function document_vault.set_updated_at();

-- =========================================================================
-- RLS — tudo bloqueado por padrão. Acesso só via API routes (service_role).
-- =========================================================================
alter table document_vault.installations  enable row level security;
alter table document_vault.webhook_events  enable row level security;
alter table document_vault.services        enable row level security;
alter table document_vault.doc_types       enable row level security;
alter table document_vault.documents       enable row level security;
alter table document_vault.sync_state      enable row level security;
alter table document_vault.access_grants   enable row level security;
alter table document_vault.audit_log       enable row level security;

-- =========================================================================
-- Seed da taxonomia (global, location_id NULL) — spec seção 5.
-- =========================================================================
insert into document_vault.services (location_id, service_key, name_pt, name_en, sort) values
  (null, 'passaporte',   'Passaporte',    'Passport',             10),
  (null, 'empresa',      'Empresa',       'Company',              20),
  (null, 'registration', 'Registration',  'Vehicle Registration', 30),
  (null, 'seguro_vida',  'Seguro de Vida','Life Insurance',       40),
  (null, 'traducao',     'Tradução',      'Translation',          50),
  (null, 'juridico',     'Jurídico',      'Legal',                60)
on conflict (coalesce(location_id, '*'), service_key) do nothing;

insert into document_vault.doc_types (service_id, doc_key, label_pt, label_en, required, sort)
select s.id, t.doc_key, t.label_pt, t.label_en, t.required, t.sort
from document_vault.services s
join (
  values
    ('passaporte','passaporte_antigo','Passaporte antigo','Old passport',      true, 10),
    ('passaporte','foto',             'Foto',              'Photo',             true, 20),
    ('passaporte','comprovante',      'Comprovante',       'Proof of payment',  true, 30),
    ('passaporte','protocolo',        'Protocolo',         'Protocol',          true, 40),
    ('empresa','id',              'ID',                      'ID',                    true, 10),
    ('empresa','comprovante_end', 'Comprovante de endereço', 'Proof of address',      true, 20),
    ('empresa','reg_nj',          'Registro NJ',             'NJ registration',       true, 30),
    ('empresa','reg_irs',         'Registro IRS',            'IRS registration',      true, 40),
    ('empresa','reg_taxation',    'Registro Taxation',       'Taxation registration', true, 50),
    ('empresa','reg_corecore',    'Registro Corecore',       'Corecore registration', true, 60),
    ('registration','titulo_veiculo','Título do veículo','Vehicle title', true, 10),
    ('registration','id',           'ID',               'ID',            true, 20),
    ('registration','seguro',       'Seguro',           'Insurance',     true, 30),
    ('seguro_vida','id',           'ID',           'ID',            true, 10),
    ('seguro_vida','aplicacao',    'Aplicação',    'Application',   true, 20),
    ('seguro_vida','ilustracao',   'Ilustração',   'Illustration',  true, 30),
    ('seguro_vida','beneficiarios','Beneficiários','Beneficiaries', true, 40),
    ('traducao','doc_origem',    'Documento de origem',  'Source document',     true, 10),
    ('traducao','doc_traduzido', 'Documento traduzido',  'Translated document', true, 20),
    ('juridico','boletim',   'Boletim/ocorrência', 'Police report',  true, 10),
    ('juridico','docs_caso', 'Documentos do caso', 'Case documents', true, 20)
) as t(service_key, doc_key, label_pt, label_en, required, sort)
  on s.service_key = t.service_key and s.location_id is null
on conflict (service_id, doc_key) do nothing;

-- 0002_document_vault.sql
-- Spark Document Vault (Cofre de Documentos) — schema V1.
--
-- Espelha todo documento salvo na nuvem do contato no GHL ("Add to documents")
-- para storage próprio da Spark, organizado por contato + serviço + tipo, com
-- checklist de pendências ("o que falta").
--
-- Reaproveita do 0001:
--   installations  → tokens GHL por location (harvester usa getLocationAccessToken)
--   audit_log      → auditoria de acesso/download (audit() com resource_type='vault_document')
--   set_updated_at → trigger de updated_at
--
-- Pré-requisitos: pgcrypto (gen_random_uuid) — já habilitado no 0001.

create extension if not exists pgcrypto;

-- =========================================================================
-- vault_services
-- Catálogo de serviços da Spark. Seed global mora com location_id NULL;
-- uma location pode sobrescrever/estender criando linhas próprias.
-- É a raiz da taxonomia ("por serviço, o que se espera").
-- =========================================================================
create table if not exists vault_services (
  id            uuid primary key default gen_random_uuid(),
  location_id   text references installations(location_id) on delete cascade,  -- NULL = seed global
  service_key   text not null,   -- passaporte | empresa | registration | seguro_vida | traducao | juridico
  name_pt       text not null,
  name_en       text not null,
  sort          int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Unicidade tratando NULL como '*' (seed global x override por location).
create unique index if not exists uq_vault_services_key
  on vault_services (coalesce(location_id, '*'), service_key);

-- =========================================================================
-- vault_doc_types  (o "doc_checklist_template")
-- Para cada serviço, os tipos de documento esperados. É isto que dispara
-- o motor de "o que falta".
-- =========================================================================
create table if not exists vault_doc_types (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null references vault_services(id) on delete cascade,
  doc_key       text not null,
  label_pt      text not null,
  label_en      text not null,
  required      boolean not null default true,
  sort          int  not null default 0,
  created_at    timestamptz not null default now(),
  unique (service_id, doc_key)
);

-- =========================================================================
-- vault_documents
-- Um registro por documento espelhado. contact_id pode nascer NULL quando a
-- fonte é a media library e o dono ainda não foi resolvido (ver D1 / fallback
-- por conversa). NUNCA guardar a URL do GHL em claro — ghl_url_enc é AES-256-GCM.
-- =========================================================================
create table if not exists vault_documents (
  id                 uuid primary key default gen_random_uuid(),
  location_id        text not null references installations(location_id) on delete cascade,
  contact_id         text,                 -- GHL contactId (NULL enquanto não resolvido)
  contact_name       text,
  service_key        text,                 -- inferido/atribuído (aponta vault_services.service_key)
  doc_key            text,                 -- tipo inferido/atribuído (aponta vault_doc_types.doc_key)
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
  checksum           text,                 -- sha256 do conteúdo (dedup entre fontes)
  status             text not null default 'pending'
                       check (status in ('pending', 'mirrored', 'failed', 'quarantined')),
  captured_at        timestamptz not null default now(),
  created_at_ghl     timestamptz,          -- createdAt reportado pela fonte (base do poll incremental)
  mirrored_at        timestamptz,
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (location_id, source, source_ref)
);
create index if not exists idx_vault_documents_contact
  on vault_documents(location_id, contact_id);
create index if not exists idx_vault_documents_service
  on vault_documents(location_id, service_key);
create index if not exists idx_vault_documents_pending
  on vault_documents(captured_at)
  where status in ('pending', 'failed');
create index if not exists idx_vault_documents_checksum
  on vault_documents(location_id, checksum)
  where checksum is not null;

-- =========================================================================
-- vault_sync_state
-- Cursor do poll incremental, por location e por fonte. O harvester lê o
-- last_cursor, busca só o que veio depois, e avança.
-- =========================================================================
create table if not exists vault_sync_state (
  location_id   text not null references installations(location_id) on delete cascade,
  source        text not null
                  check (source in ('media', 'conversation', 'form')),
  last_cursor   text,                 -- ISO createdAt ou offset, conforme a fonte
  last_run_at   timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (location_id, source)
);

-- =========================================================================
-- vault_access_grants
-- Controle de acesso por departamento, espelhando as permissões do GHL
-- (a Nicole não vê doc de empresa da Ana). Fonte da verdade das permissões
-- ainda é decisão pendente (ver docs/document-vault.md → D4).
-- =========================================================================
create table if not exists vault_access_grants (
  id            uuid primary key default gen_random_uuid(),
  location_id   text not null references installations(location_id) on delete cascade,
  ghl_user_id   text,                 -- usuário do GHL
  department    text,                 -- departamento (espelha permissão GHL)
  scope         text not null default 'department'
                  check (scope in ('all', 'department', 'contact')),
  contact_id    text,                 -- usado quando scope='contact'
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_vault_access_grants
  on vault_access_grants (
    location_id,
    coalesce(ghl_user_id, ''),
    coalesce(department, ''),
    coalesce(contact_id, '')
  );

-- =========================================================================
-- updated_at triggers (reusa set_updated_at() do 0001)
-- =========================================================================
drop trigger if exists trg_vault_services_updated on vault_services;
create trigger trg_vault_services_updated before update on vault_services
  for each row execute function set_updated_at();

drop trigger if exists trg_vault_documents_updated on vault_documents;
create trigger trg_vault_documents_updated before update on vault_documents
  for each row execute function set_updated_at();

drop trigger if exists trg_vault_sync_state_updated on vault_sync_state;
create trigger trg_vault_sync_state_updated before update on vault_sync_state
  for each row execute function set_updated_at();

-- =========================================================================
-- RLS — tudo bloqueado por padrão. Acesso só via API routes (service_role).
-- =========================================================================
alter table vault_services      enable row level security;
alter table vault_doc_types     enable row level security;
alter table vault_documents     enable row level security;
alter table vault_sync_state    enable row level security;
alter table vault_access_grants enable row level security;

-- =========================================================================
-- Seed da taxonomia (global, location_id NULL) — spec seção 5.
-- Idempotente: on conflict não sobrescreve overrides por location.
-- =========================================================================
insert into vault_services (location_id, service_key, name_pt, name_en, sort) values
  (null, 'passaporte',   'Passaporte',   'Passport',            10),
  (null, 'empresa',      'Empresa',      'Company',             20),
  (null, 'registration', 'Registration', 'Vehicle Registration',30),
  (null, 'seguro_vida',  'Seguro de Vida','Life Insurance',     40),
  (null, 'traducao',     'Tradução',     'Translation',         50),
  (null, 'juridico',     'Jurídico',     'Legal',               60)
on conflict (coalesce(location_id, '*'), service_key) do nothing;

-- doc_types por serviço (só para o seed global). doc_key em snake_case.
insert into vault_doc_types (service_id, doc_key, label_pt, label_en, required, sort)
select s.id, t.doc_key, t.label_pt, t.label_en, t.required, t.sort
from vault_services s
join (
  values
    -- Passaporte
    ('passaporte','passaporte_antigo','Passaporte antigo','Old passport',        true, 10),
    ('passaporte','foto',             'Foto',              'Photo',               true, 20),
    ('passaporte','comprovante',      'Comprovante',       'Proof of payment',    true, 30),
    ('passaporte','protocolo',        'Protocolo',         'Protocol',            true, 40),
    -- Empresa
    ('empresa','id',               'ID',                       'ID',                     true, 10),
    ('empresa','comprovante_end',  'Comprovante de endereço',  'Proof of address',       true, 20),
    ('empresa','reg_nj',           'Registro NJ',              'NJ registration',        true, 30),
    ('empresa','reg_irs',          'Registro IRS',             'IRS registration',       true, 40),
    ('empresa','reg_taxation',     'Registro Taxation',        'Taxation registration',  true, 50),
    ('empresa','reg_corecore',     'Registro Corecore',        'Corecore registration',  true, 60),
    -- Registration
    ('registration','titulo_veiculo','Título do veículo','Vehicle title', true, 10),
    ('registration','id',           'ID',               'ID',            true, 20),
    ('registration','seguro',       'Seguro',           'Insurance',     true, 30),
    -- Seguro de vida
    ('seguro_vida','id',           'ID',           'ID',            true, 10),
    ('seguro_vida','aplicacao',    'Aplicação',    'Application',    true, 20),
    ('seguro_vida','ilustracao',   'Ilustração',   'Illustration',  true, 30),
    ('seguro_vida','beneficiarios','Beneficiários','Beneficiaries', true, 40),
    -- Tradução
    ('traducao','doc_origem',    'Documento de origem',  'Source document',     true, 10),
    ('traducao','doc_traduzido', 'Documento traduzido',  'Translated document', true, 20),
    -- Jurídico
    ('juridico','boletim',   'Boletim/ocorrência',   'Police report',   true, 10),
    ('juridico','docs_caso', 'Documentos do caso',   'Case documents',  true, 20)
) as t(service_key, doc_key, label_pt, label_en, required, sort)
  on s.service_key = t.service_key and s.location_id is null
on conflict (service_id, doc_key) do nothing;

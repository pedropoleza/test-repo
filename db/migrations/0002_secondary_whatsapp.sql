-- 0002_secondary_whatsapp.sql
-- Secondary WhatsApp Conversation Provider — bridge entre uma MAIN subaccount
-- (camada operacional) e uma GHOST subaccount (camada de transporte que hospeda
-- o segundo número de WhatsApp).
--
-- Camadas:
--   MAIN  = operational layer (CRM, Conversations, atendentes)
--   GHOST = transport layer (só existe pra hospedar o WhatsApp #2)
--   APP   = bridge layer (este middleware)
--
-- REGRA FUNDAMENTAL: nunca duplicar a operação entre as duas contas.
-- A Ghost é invisível pro atendente; toda a UX vive na Main.
--
-- Pré-requisitos: extensão pgcrypto (gen_random_uuid) — default no Supabase.
-- Reusa a function public.set_updated_at() criada em 0001_init.sql.

create extension if not exists pgcrypto;

-- =========================================================================
-- provider_installations
-- Uma linha por tenant/instalação. Liga uma Main subaccount à sua Ghost
-- subaccount e ao Conversation Provider registrado no Marketplace App.
--
-- Nada de ghostLocationId / providerId hardcoded (§13): tudo vem daqui,
-- resolvido em runtime. Isso é o que transforma o sistema em produto —
-- Main A ↔ Ghost A, Main B ↔ Ghost B, isoladamente.
--
-- Tokens ficam criptografados em repouso (AES-256-GCM, TOKEN_ENCRYPTION_KEY,
-- mesmo esquema de lib/server/crypto.js). Podem ser NULL quando a operação
-- usa um token de app compartilhado (GHL_APP_ACCESS_TOKEN) via env.
-- =========================================================================
create table if not exists provider_installations (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                text not null,
  agency_id                text,

  -- MAIN (operational layer)
  main_location_id         text not null,
  main_location_name       text,
  main_access_token        text,                       -- AES-256-GCM (base64) | null → usa app token

  -- GHOST (transport layer)
  ghost_location_id        text not null,
  ghost_location_name      text,
  ghost_access_token       text,                       -- AES-256-GCM (base64) | null → usa app token
  ghost_whatsapp_number    text,                       -- E.164, ex.: +14075551234

  -- Conversation Provider (Marketplace App)
  conversation_provider_id text not null,
  provider_alias           text default 'WhatsApp 2',
  provider_logo_url        text,

  status                   text not null default 'active'
                             check (status in ('active', 'disabled', 'error', 'pending')),
  last_error               text,
  last_checked_at          timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- Um provider por Main location (o par Main↔Ghost é 1:1 por instalação).
  unique (main_location_id, conversation_provider_id)
);
create index if not exists idx_provider_inst_tenant
  on provider_installations(tenant_id);
create unique index if not exists uq_provider_inst_main
  on provider_installations(main_location_id);
create unique index if not exists uq_provider_inst_ghost
  on provider_installations(ghost_location_id);
create index if not exists idx_provider_inst_provider
  on provider_installations(conversation_provider_id);
create index if not exists idx_provider_inst_status
  on provider_installations(status);

-- =========================================================================
-- contact_channel_mapping (§4)
-- Liga o mesmo cliente nas duas contas. Chave de matching primária é o
-- telefone normalizado (E.164), mas depois do primeiro match guardamos os
-- ids dos dois lados pra rotear as próximas mensagens imediatamente, sem
-- depender só do telefone.
-- =========================================================================
create table if not exists contact_channel_mapping (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              text not null,

  main_location_id       text not null,
  main_contact_id        text not null,
  main_conversation_id   text,

  ghost_location_id      text not null,
  ghost_contact_id       text,
  ghost_conversation_id  text,

  provider_id            text not null,
  phone_normalized       text not null,                -- E.164

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
-- Um contato por telefone dentro de um tenant/provider (chave de roteamento).
create unique index if not exists uq_ccm_tenant_provider_phone
  on contact_channel_mapping(tenant_id, provider_id, phone_normalized);
create index if not exists idx_ccm_main_contact
  on contact_channel_mapping(main_location_id, main_contact_id);
create index if not exists idx_ccm_ghost_contact
  on contact_channel_mapping(ghost_location_id, ghost_contact_id);
create index if not exists idx_ccm_phone
  on contact_channel_mapping(phone_normalized);

-- =========================================================================
-- message_bridge (§8)
-- Relaciona as mensagens entre as duas contas. Essencial pra dedupe, sync de
-- status, replies, attachments, debugging e auditoria.
--
-- source_message_id (§9): id do evento de ORIGEM (ghostMessageId no inbound,
-- main messageId no outbound). UNIQUE — é a trava de deduplicação. Antes de
-- processar qualquer webhook: se já existe, ignora.
--
-- origin = 'spark_bridge' (§10): marca mensagens originadas pelo próprio
-- middleware. Quando o webhook correspondente voltar (ghost_message_id já
-- presente), NÃO reenviamos pra Main — quebra o loop
-- Ghost→Main→webhook→Ghost→...
-- =========================================================================
create table if not exists message_bridge (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null,

  direction            text not null check (direction in ('INBOUND', 'OUTBOUND')),
  origin               text not null default 'ghl'
                         check (origin in ('ghl', 'spark_bridge')),

  -- Trava de dedupe: id do evento que originou este bridge.
  source_message_id    text not null,

  main_message_id      text,
  ghost_message_id     text,

  main_contact_id      text,
  ghost_contact_id     text,

  provider_id          text not null,

  -- id retornado pela API externa ao enviar (WhatsApp/GHL).
  external_message_id  text,

  status               text not null default 'pending'
                         check (status in ('pending', 'sent', 'delivered', 'read', 'failed')),
  error                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- Dedupe forte: nunca processa o mesmo evento de origem duas vezes.
create unique index if not exists uq_message_bridge_source
  on message_bridge(source_message_id);
-- Loop guard: lookup rápido do ghost_message_id que NÓS geramos no outbound.
create unique index if not exists uq_message_bridge_ghost_msg
  on message_bridge(ghost_message_id)
  where ghost_message_id is not null;
create index if not exists idx_message_bridge_main_msg
  on message_bridge(main_message_id)
  where main_message_id is not null;
create index if not exists idx_message_bridge_tenant_created
  on message_bridge(tenant_id, created_at desc);
create index if not exists idx_message_bridge_status
  on message_bridge(status);

-- =========================================================================
-- whatsapp_message_logs (§15)
-- Área de "Message Logs" da UI. Espelha cada trânsito de mensagem num shape
-- fácil de ler, pra diagnosticar sem entrar no banco.
--   Ghost → Main  (inbound)   |  Main → Ghost (outbound)
-- =========================================================================
create table if not exists whatsapp_message_logs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null,
  provider_id       text,

  occurred_at       timestamptz not null default now(),
  contact_name      text,
  phone             text,
  direction         text check (direction in ('INBOUND', 'OUTBOUND')),
  message_preview   text,
  source            text,                              -- 'Ghost' | 'Main'
  destination       text,                              -- 'Main'  | 'Ghost' | 'WhatsApp'
  status            text,
  error             text,

  bridge_id         uuid references message_bridge(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_wa_logs_tenant_time
  on whatsapp_message_logs(tenant_id, occurred_at desc);
create index if not exists idx_wa_logs_direction
  on whatsapp_message_logs(direction);

-- =========================================================================
-- updated_at triggers (reusa public.set_updated_at de 0001)
-- =========================================================================
drop trigger if exists trg_provider_inst_updated on provider_installations;
create trigger trg_provider_inst_updated before update on provider_installations
  for each row execute function set_updated_at();

drop trigger if exists trg_ccm_updated on contact_channel_mapping;
create trigger trg_ccm_updated before update on contact_channel_mapping
  for each row execute function set_updated_at();

drop trigger if exists trg_message_bridge_updated on message_bridge;
create trigger trg_message_bridge_updated before update on message_bridge
  for each row execute function set_updated_at();

-- =========================================================================
-- RLS — tudo bloqueado. Acesso só via service_role nas API routes.
-- =========================================================================
alter table provider_installations   enable row level security;
alter table contact_channel_mapping  enable row level security;
alter table message_bridge           enable row level security;
alter table whatsapp_message_logs    enable row level security;

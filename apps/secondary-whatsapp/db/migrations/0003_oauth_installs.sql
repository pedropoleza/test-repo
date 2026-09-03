-- 0003_oauth_installs.sql
-- Captura os tokens do Marketplace App obtidos no OAuth install (§12).
--
-- O install do app (OAuth) é o que faz o Custom Conversation Provider aparecer
-- no Conversations da location. Além de completar o handshake, guardamos o
-- access/refresh token do APP — é o token exigido pela API de status do provider
-- (o provider "pertence" ao app), que os PITs por-location não conseguem fazer.
--
-- Tokens criptografados em repouso (AES-256-GCM, TOKEN_ENCRYPTION_KEY).
-- Reusa public.set_updated_at() de 0001.

create table if not exists wa_oauth_installs (
  location_id    text primary key,
  company_id     text,
  user_type      text,
  access_token   text not null,                 -- AES-256-GCM (base64)
  refresh_token  text,                          -- AES-256-GCM (base64)
  expires_at     timestamptz,
  scope          text,
  installed_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_wa_oauth_company on wa_oauth_installs(company_id);
create index if not exists idx_wa_oauth_updated on wa_oauth_installs(updated_at desc);

drop trigger if exists trg_wa_oauth_updated on wa_oauth_installs;
create trigger trg_wa_oauth_updated before update on wa_oauth_installs
  for each row execute function set_updated_at();

alter table wa_oauth_installs enable row level security;

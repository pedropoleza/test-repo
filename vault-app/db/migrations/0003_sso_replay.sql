-- 0003_sso_replay.sql
-- Anti-replay do handshake do Custom Page (/api/session).
-- Cada payload cifrado do SSO é hasheado (SHA-256); o mesmo digest 2x em
-- janela curta é rejeitado. GC best-effort no próprio endpoint.
--
-- Aplicado no projeto Supabase: Sparkleads OS (nsqwgjbgcdqyzozyaltz).

create table if not exists document_vault.sso_replay (
  digest       text primary key,
  received_at  timestamptz not null default now()
);
create index if not exists idx_dv_sso_replay_received
  on document_vault.sso_replay(received_at);

alter table document_vault.sso_replay enable row level security;

-- Grant + policy para o role dedicado dv_app (mesma lógica das outras tabelas).
grant select, insert, delete on document_vault.sso_replay to dv_app;
drop policy if exists dv_app_all on document_vault.sso_replay;
create policy dv_app_all on document_vault.sso_replay to dv_app using (true) with check (true);

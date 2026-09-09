-- 0011_status_tokens.sql
-- Tokens do portal de status do cliente.
--
-- Um link/QR por contato que abre uma página pública com o andamento dos
-- serviços dele, no idioma dele. O token no endereço é a credencial: dá
-- acesso SÓ ao status daquele contato, sem sessão, e pode ser revogado.
--
-- Próprio do contato (não da página): o portal é sobre a pessoa, não
-- sobre um documento. Um token vivo por contato — reabrir reaproveita o
-- mesmo QR em vez de imprimir um novo a cada vez.

create table if not exists workspace_status_tokens (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  contact_external_id text not null,
  token               text not null,
  created_by          text,
  created_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  last_used_at        timestamptz,
  use_count           integer not null default 0
);

create unique index if not exists uq_status_tokens_token
  on workspace_status_tokens(token);
create unique index if not exists uq_status_tokens_contact
  on workspace_status_tokens(workspace_id, contact_external_id)
  where revoked_at is null;

alter table workspace_status_tokens enable row level security;

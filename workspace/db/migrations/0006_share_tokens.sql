-- 0006_share_tokens.sql
-- Tokens de compartilhamento por página: o que o QR code carrega.
--
-- POR QUE UM TOKEN, E NÃO A URL DA PÁGINA
-- Quem lê o QR está fora do workspace — é a pessoa com o celular na mão,
-- talvez sem sessão nenhuma. Mandar a URL da página exigiria login e
-- entregaria o workspace inteiro. O token dá acesso a UMA coisa: o PDF
-- daquela ficha, somente leitura.
--
-- O token é estável de propósito. Um QR impresso ou colado num contrato
-- não pode parar de funcionar porque o token expirou; quando for preciso
-- cortar o acesso, `revoked_at` invalida aquele QR sem tocar nos outros.
--
-- QUEM TEM O QR TEM OS DADOS DAQUELE CONTATO. É a natureza do pedido —
-- ler e baixar sem login — e está registrado no runbook.

create table if not exists workspace_share_tokens (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  page_id      uuid not null references workspace_pages(id) on delete cascade,
  token        text not null,
  kind         text not null default 'dossier_pdf'
                 check (kind in ('dossier_pdf')),
  created_by   text,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  last_used_at timestamptz,
  use_count    integer not null default 0
);

-- Busca pelo token é o caminho quente: toda leitura do QR passa por aqui.
create unique index if not exists uq_workspace_share_tokens_token
  on workspace_share_tokens(token);
-- Um token vivo por página e tipo: reabrir a ficha reaproveita o mesmo QR
-- em vez de imprimir um novo a cada visita.
create unique index if not exists uq_workspace_share_tokens_page
  on workspace_share_tokens(page_id, kind)
  where revoked_at is null;

alter table workspace_share_tokens enable row level security;

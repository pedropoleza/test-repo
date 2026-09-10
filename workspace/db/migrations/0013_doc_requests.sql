-- 0013_doc_requests.sql
-- Pedidos de assinatura de documento.
--
-- O fluxo: a equipe manda um LINK ÚNICO para o lead; ele abre uma página
-- com o documento já pré-preenchido com o que o CRM sabe dele, corrige o
-- que precisar, assina (desenhando ou digitando) e aprova. Na aprovação
-- o PDF real é carimbado, um certificado de assinatura é anexado, o
-- arquivo cai na ficha e a equipe é avisada.
--
-- Um pedido = um link = um documento. O token é a credencial de quem
-- abre; `status` conta a história (pendente → aberto → assinado).
-- `prefill` guarda o que foi enviado; `valores`, o que ele confirmou —
-- ter os dois separados mostra o que o cliente corrigiu.

create table if not exists workspace_doc_requests (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  contact_external_id text not null,
  acordo              text not null,
  slug                text not null,
  idioma              text not null default 'pt',
  token               text not null,
  status              text not null default 'pendente'
                        check (status in ('pendente','aberto','assinado','cancelado')),
  prefill             jsonb not null default '{}'::jsonb,
  valores             jsonb not null default '{}'::jsonb,
  assinado_por        text,
  assinatura_tipo     text check (assinatura_tipo in ('desenhada','digitada')),
  assinado_em         timestamptz,
  assinado_ip         text,
  file_id             uuid,
  criado_por          text,
  created_at          timestamptz not null default now(),
  opened_at           timestamptz,
  updated_at          timestamptz not null default now()
);

create unique index if not exists uq_doc_requests_token
  on workspace_doc_requests(token);
create index if not exists ix_doc_requests_contato
  on workspace_doc_requests(workspace_id, contact_external_id, created_at desc);
create index if not exists ix_doc_requests_status
  on workspace_doc_requests(workspace_id, status, created_at desc);

alter table workspace_doc_requests enable row level security;

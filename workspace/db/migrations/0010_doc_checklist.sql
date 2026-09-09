-- 0010_doc_checklist.sql
-- Checklist de documentos por serviço.
--
-- Cada serviço exige um conjunto de documentos do cliente (vem do
-- catálogo). Aqui guarda-se o ESTADO de cada um por contato: pendente,
-- recebido, enviado ao terceiro, devolvido. É o "marcar documentos
-- enviados" — e é o que dá pra cruzar depois em "quem está aguardando
-- documento e há quanto tempo".
--
-- Ausência de linha = pendente. Só se grava o que saiu do padrão.

create table if not exists workspace_doc_checklist (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  contact_external_id text not null,
  service_code        text not null,
  item                text not null,
  state               text not null default 'pendente'
                        check (state in ('pendente','recebido','enviado','devolvido')),
  updated_by          text,
  updated_at          timestamptz not null default now()
);

create unique index if not exists uq_doc_checklist
  on workspace_doc_checklist(workspace_id, contact_external_id, service_code, item);

alter table workspace_doc_checklist enable row level security;

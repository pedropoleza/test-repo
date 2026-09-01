-- 0007_contact_relations.sql
-- Associações entre contatos: "esta pessoa é filha daquela".
--
-- POR QUE UMA TABELA, E NÃO UM CAMPO NO BLOCO
-- O cartão de contato numa página é APRESENTAÇÃO. Guardar o parentesco
-- nele faria a informação existir só naquela página: abrir a ficha do
-- filho não mostraria o pai, e apagar o bloco apagaria o vínculo. O
-- parentesco é um fato sobre as duas pessoas, não sobre uma página.
--
-- SIMÉTRICA POR CONSTRUÇÃO
-- Toda associação é gravada NOS DOIS SENTIDOS, com o rótulo invertido
-- (filho ↔ pai/mãe). Assim qualquer consulta é uma leitura direta por
-- contact_id, sem OR nem UNION, e nenhuma das duas fichas pode "esquecer"
-- a outra.
--
-- Sem foreign key para o contato: ele mora no CRM, não neste banco
-- (decisão D10). A integridade é do CRM; aqui guardamos o vínculo.

create table if not exists workspace_contact_relations (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  contact_id         text not null,
  related_contact_id text not null,
  relation           text not null,
  created_by         text,
  created_at         timestamptz not null default now(),
  constraint sem_auto_relacao check (contact_id <> related_contact_id)
);

-- Um vínculo por par e sentido: marcar duas vezes atualiza o rótulo em
-- vez de criar uma segunda linha.
create unique index if not exists uq_contact_relations_par
  on workspace_contact_relations(workspace_id, contact_id, related_contact_id);
create index if not exists idx_contact_relations_contato
  on workspace_contact_relations(workspace_id, contact_id);

alter table workspace_contact_relations enable row level security;

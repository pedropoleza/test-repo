-- 0012_comments.sql
-- Comentários na ficha do contato, com @menções.
--
-- É o "post-it de time" que faltava: um fio de comentários preso ao
-- contato, onde a equipe registra "faltou o RG, cobrei dia 3", "cliente
-- pediu para ligar depois das 17h", "@Samantha confere a apólice". O CRM
-- do GHL não guarda isso de forma visível na operação; aqui fica.
--
-- Preso ao contato (external id), não à página: assim o fio sobrevive se
-- a pasta for recriada, do mesmo jeito que o checklist de documentos.
--
-- Sem login no app: o autor é escolhido da lista de usuários do GHL e
-- lembrado no dispositivo. As @menções ficam guardadas em `mentions`
-- (ids dos usuários citados) para, no futuro, virar notificação.
--
-- Exclusão é lógica (deleted_at): tira do fio sem furar o histórico.

create table if not exists workspace_comments (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  contact_external_id text not null,
  body                text not null,
  author              text not null default 'Equipe',
  mentions            text[] not null default '{}',
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists ix_comments_contact
  on workspace_comments(workspace_id, contact_external_id, created_at);

alter table workspace_comments enable row level security;

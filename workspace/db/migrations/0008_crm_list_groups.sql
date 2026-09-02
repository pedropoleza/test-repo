-- 0008_crm_list_groups.sql
-- Agrupamento das abas de CRM na navegação.
--
-- Uma conta com seis pipelines vira seis abas soltas embaixo de "CRM", e
-- seis itens sem hierarquia são uma lista, não uma organização. O grupo
-- é o que separa "Seguros" de "Serviços" na barra lateral.
--
-- Coluna, e não mais uma chave dentro de `filters`: `filters` é a
-- PERGUNTA que a aba faz ao CRM (pipeline, estágio, e amanhã tag e
-- responsável). Onde a aba aparece na tela não é pergunta — misturar as
-- duas coisas faria "limpar os filtros" mover a aba de lugar.
--
-- Sem valor é aba solta, como hoje: contas que não agrupam nada seguem
-- exatamente como estavam.

alter table workspace_crm_lists
  add column if not exists group_name text;

-- A ordem dentro do grupo já sai de `position`; o índice acompanha para
-- a navegação não precisar ordenar em memória.
create index if not exists idx_workspace_crm_lists_group
  on workspace_crm_lists(workspace_id, group_name, position);

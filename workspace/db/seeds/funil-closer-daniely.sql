-- Funil do Closer — conta da Daniely (tenant mqO0er6vDQahqWGS1FYJ).
--
-- Não é migração: é CONTEÚDO de uma conta, criado uma vez. Fica versionado
-- aqui porque a estrutura foi desenhada a partir do funil que ela já usava
-- (o quadro "CRM → CLOSER [seguros]"), e no dia em que alguém perguntar de
-- onde vieram estas sete etapas a resposta tem que estar em algum lugar.
--
-- Idempotente pelo título: rodar de novo não duplica.
--
-- As etapas e os campos saíram do quadro dela mais o que foi combinado:
-- telefone e e-mail (contato), origem do lead e data da reunião (de onde
-- vem e desde quando está parado), e três campos de notas, porque o que
-- o closer anota numa call não cabe numa linha.
do $$
declare
  ws     uuid := '605ce0a6-f580-44ea-988e-bd39563d8674';
  who    text := 'fixed:mqO0er6vDQahqWGS1FYJ';
  pg     uuid;
  db     uuid;
  vboard uuid;
begin
  if exists (select 1 from workspace_pages
             where workspace_id = ws and title = 'CRM → CLOSER [seguros]' and is_archived = false) then
    raise notice 'funil ja existe, nada a fazer';
    return;
  end if;

  -- layout_width 'full': um funil de sete colunas dentro da coluna de
  -- leitura de uma página mostraria três.
  insert into workspace_pages (workspace_id, title, icon_type, icon_value,
                               layout_width, visibility, position, created_by, updated_by)
  values (ws, 'CRM → CLOSER [seguros]', 'emoji', '🎯', 'full', 'shared', 'a', who, who)
  returning id into pg;

  insert into workspace_databases (workspace_id, page_id, title, icon_type, icon_value,
                                   description, created_by, updated_by)
  values (ws, pg, 'CRM → CLOSER [seguros]', 'emoji', '🎯',
          'O funil do closer: cada card é um lead, cada coluna uma etapa.', who, who)
  returning id into db;

  insert into workspace_database_fields (workspace_id, database_id, key, name, type, config, is_primary, position)
  values
    (ws, db, 'nome_completo', 'Nome completo', 'text', '{}'::jsonb, true, 'a'),
    (ws, db, 'etapas_closer', 'Etapas Closer', 'select', jsonb_build_object('options', jsonb_build_array(
        jsonb_build_object('id','reuniao_dani','name','Reunião com a Dani','color','orange'),
        jsonb_build_object('id','sinal_verde','name','Sinal Verde','color','green'),
        jsonb_build_object('id','pre_aplicacao','name','Pré-aplicação','color','blue'),
        jsonb_build_object('id','aplicacao_enviada','name','Aplicação enviada','color','purple'),
        jsonb_build_object('id','underwriting','name','Underwriting','color','yellow'),
        jsonb_build_object('id','emitida','name','Emitida','color','green'),
        jsonb_build_object('id','perdido','name','Perdido','color','red')
      )), false, 'b'),
    (ws, db, 'telefone', 'Telefone', 'phone', '{}'::jsonb, false, 'c'),
    (ws, db, 'email', 'E-mail', 'email', '{}'::jsonb, false, 'd'),
    (ws, db, 'origem_lead', 'Origem do lead', 'select', jsonb_build_object('options', jsonb_build_array(
        jsonb_build_object('id','indicacao','name','Indicação','color','green'),
        jsonb_build_object('id','instagram','name','Instagram','color','pink'),
        jsonb_build_object('id','anuncio','name','Anúncio','color','blue'),
        jsonb_build_object('id','lista','name','Lista','color','gray'),
        jsonb_build_object('id','evento','name','Evento','color','purple'),
        jsonb_build_object('id','outro','name','Outro','color','brown')
      )), false, 'e'),
    (ws, db, 'data_reuniao', 'Data da reunião', 'date', '{}'::jsonb, false, 'f'),
    (ws, db, 'proxima_acao', 'Próxima ação', 'text', '{}'::jsonb, false, 'g'),
    (ws, db, 'data_nascimento', 'Data de nascimento', 'date', '{}'::jsonb, false, 'h'),
    (ws, db, 'estado_onde_mora', 'Estado onde mora', 'text', '{}'::jsonb, false, 'i'),
    (ws, db, 'participa_decisao', 'Participa da decisão', 'text', '{}'::jsonb, false, 'j'),
    (ws, db, 'valor_por_mes', 'Valor disposto a guardar por mês', 'number', '{}'::jsonb, false, 'k'),
    (ws, db, 'maior_interesse', 'Maior interesse', 'text', '{}'::jsonb, false, 'l'),
    (ws, db, 'perfil_cliente', 'Perfil do cliente', 'long_text', '{}'::jsonb, false, 'm'),
    (ws, db, 'objecoes', 'Objeções apresentadas', 'long_text', '{}'::jsonb, false, 'n'),
    (ws, db, 'notas', 'Notas', 'long_text', '{}'::jsonb, false, 'o');

  -- O quadro é a vista principal (position 'a'); a tabela fica ao lado
  -- para quando ela quiser ver tudo de uma vez, filtrar e ordenar.
  -- Na frente do card só três campos: telefone (ligar), data da reunião
  -- (desde quando) e próxima ação (o que fazer). O resto está na ficha.
  insert into workspace_database_views (workspace_id, database_id, name, type, group_by, visible_fields, position)
  values (ws, db, 'Etapas Closer', 'board', 'etapas_closer',
          '["telefone","data_reuniao","proxima_acao"]'::jsonb, 'a')
  returning id into vboard;

  insert into workspace_database_views (workspace_id, database_id, name, type, position)
  values (ws, db, 'Todos os leads', 'table', 'b');

  insert into workspace_blocks (workspace_id, page_id, type, content, position, created_by, updated_by)
  values (ws, pg, 'database',
          jsonb_build_object('databaseId', db::text, 'viewId', vboard::text), 'a', who, who);

  raise notice 'funil criado: page=% db=%', pg, db;
end $$;

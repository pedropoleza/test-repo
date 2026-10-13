-- Funis de SDR e Closer — conta da Daniely (tenant mqO0er6vDQahqWGS1FYJ).
--
-- Não é migração: é CONTEÚDO de uma conta, criado uma vez. Fica versionado
-- aqui porque a estrutura foi desenhada a partir do funil que ela já usava
-- (o quadro "CRM → CLOSER [seguros]"), e no dia em que alguém perguntar de
-- onde vieram estas sete etapas a resposta tem que estar em algum lugar.
--
-- Idempotente pelo título: rodar de novo não duplica.
--
-- As etapas vieram das referências que ela usa hoje: a lista do SDR
-- (NOVO LEAD → … → CLOSER) e a do Closer (1ª REUNIÃO REALIZADA → … →
-- APÓLICE EMITIDA), com a definição de cada etapa escrita junto. A
-- definição mora na OPÇÃO do campo, não num documento à parte: "Em
-- decisão" não diz nada sozinho, e quem precisa da definição está
-- olhando para a coluna.
--
-- Os campos saíram da ficha do lead daquele quadro mais o que foi
-- combinado: telefone e e-mail (contato), origem do lead e data da
-- reunião (de onde vem e desde quando está parado), e campos de notas,
-- porque o que se anota numa call não cabe numa linha.
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
        jsonb_build_object('id','reuniao_1','name','1ª Reunião realizada','color','blue',
          'description','Cliente compareceu e fez a primeira reunião.'),
        jsonb_build_object('id','sinal_verde','name','Sinal Verde','color','green',
          'description','Passou os dados, demonstrou interesse e está considerando avançar.'),
        jsonb_build_object('id','planejamento_enviado','name','Planejamento enviado','color','purple',
          'description','Números/opções enviados para análise.'),
        jsonb_build_object('id','em_decisao','name','Em decisão','color','yellow',
          'description','Cliente disse “vou pensar”, “vou analisar” ou precisa conversar com o cônjuge.'),
        jsonb_build_object('id','reuniao_2','name','2ª Reunião agendada','color','orange',
          'description','Data e horário definidos para decisão/fechamento.'),
        jsonb_build_object('id','fechamento','name','Fechamento com confiança','color','pink',
          'description','Cliente decidiu avançar.'),
        jsonb_build_object('id','aplicacao_enviada','name','Aplicação enviada','color','blue',
          'description','Formulário de aplicação enviado à seguradora.'),
        jsonb_build_object('id','underwriting','name','Underwriting','color','brown',
          'description','A seguradora está analisando o risco.'),
        jsonb_build_object('id','aprovada','name','Aprovada','color','green',
          'description','Underwriting aprovou a proposta.'),
        jsonb_build_object('id','pendente_ativacao','name','Pendente de ativação','color','yellow',
          'description','Falta o primeiro pagamento ou a assinatura para ativar.'),
        jsonb_build_object('id','apolice_emitida','name','Apólice emitida','color','green',
          'description','Apólice emitida e entregue ao cliente.')
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
  -- Sem visible_fields: o que foi escrito na ficha aparece no card. Quem
  -- quiser varrer o funil de onze colunas aperta o card para Médio ou
  -- Compacto na própria tela — recortar campos aqui escondia justamente
  -- o que a pessoa acabou de escrever.
  insert into workspace_database_views (workspace_id, database_id, name, type, group_by, layout, position)
  values (ws, db, 'Etapas Closer', 'board', 'etapas_closer',
          '{"cardSize":"completo"}'::jsonb, 'a')
  returning id into vboard;

  insert into workspace_database_views (workspace_id, database_id, name, type, position)
  values (ws, db, 'Todos os leads', 'table', 'b');

  insert into workspace_blocks (workspace_id, page_id, type, content, position, created_by, updated_by)
  values (ws, pg, 'database',
          jsonb_build_object('databaseId', db::text, 'viewId', vboard::text), 'a', who, who);

  raise notice 'funil criado: page=% db=%', pg, db;
end $$;

-- =====================================================================
-- CRM → SDR [seguros]
--
-- O funil de antes: da chegada do lead até ele sentar com a Dani. Vive
-- separado do closer porque é outro trabalho e outra pessoa — misturar
-- os dois num quadro só daria dezenove colunas e nenhuma leitura.
--
-- Position 'Z' (maiúscula ordena antes de 'a'): na barra o SDR vem antes
-- do CLOSER, que é a ordem em que o lead anda.
-- =====================================================================
do $$
declare
  ws     uuid := '605ce0a6-f580-44ea-988e-bd39563d8674';
  who    text := 'fixed:mqO0er6vDQahqWGS1FYJ';
  pg     uuid;
  db     uuid;
  vboard uuid;
begin
  if exists (select 1 from workspace_pages
             where workspace_id = ws and title = 'CRM → SDR [seguros]' and is_archived = false) then
    raise notice 'funil SDR ja existe, nada a fazer';
    return;
  end if;

  insert into workspace_pages (workspace_id, title, icon_type, icon_value,
                               layout_width, visibility, position, created_by, updated_by)
  values (ws, 'CRM → SDR [seguros]', 'emoji', '📞', 'full', 'shared', 'Z', who, who)
  returning id into pg;

  insert into workspace_databases (workspace_id, page_id, title, icon_type, icon_value,
                                   description, created_by, updated_by)
  values (ws, pg, 'CRM → SDR [seguros]', 'emoji', '📞',
          'Da chegada do lead até ele sentar com o closer.', who, who)
  returning id into db;

  insert into workspace_database_fields (workspace_id, database_id, key, name, type, config, is_primary, position)
  values
    (ws, db, 'nome_completo', 'Nome completo', 'text', '{}'::jsonb, true, 'a'),
    (ws, db, 'etapas_sdr', 'Etapas SDR', 'select', jsonb_build_object('options', jsonb_build_array(
        jsonb_build_object('id','novo_lead','name','Novo lead','color','gray',
          'description','Entrou e ainda não foi trabalhado.'),
        jsonb_build_object('id','tentativa_contato','name','Tentativa de contato','color','yellow',
          'description','Ligou/mandou mensagem e ainda não teve resposta.'),
        jsonb_build_object('id','contato_estabelecido','name','Contato estabelecido','color','blue',
          'description','Respondeu — a conversa começou.'),
        jsonb_build_object('id','qualificado','name','Qualificado','color','purple',
          'description','Tem perfil, interesse e condição de avançar.'),
        jsonb_build_object('id','reuniao_agendada','name','Reunião agendada','color','orange',
          'description','Data e horário marcados com a Dani.'),
        jsonb_build_object('id','no_show','name','No show / Reagendar','color','red',
          'description','Não compareceu — precisa remarcar.'),
        jsonb_build_object('id','compareceu','name','Compareceu','color','green',
          'description','Sentou na reunião. Trabalho do SDR cumprido.'),
        jsonb_build_object('id','closer','name','Closer','color','green',
          'description','Passado para o funil do closer.')
      )), false, 'b'),
    (ws, db, 'telefone', 'Telefone', 'phone', '{}'::jsonb, false, 'c'),
    (ws, db, 'email', 'E-mail', 'email', '{}'::jsonb, false, 'd'),
    (ws, db, 'origem_lead', 'Origem do lead', 'select', jsonb_build_object('options', jsonb_build_array(
        jsonb_build_object('id','indicacao','name','Indicação','color','green'),
        jsonb_build_object('id','instagram','name','Instagram','color','pink'),
        jsonb_build_object('id','facebook_ads','name','Facebook ADS','color','blue'),
        jsonb_build_object('id','anuncio','name','Anúncio','color','blue'),
        jsonb_build_object('id','lista','name','Lista','color','gray'),
        jsonb_build_object('id','evento','name','Evento','color','purple'),
        jsonb_build_object('id','outro','name','Outro','color','brown')
      )), false, 'e'),
    (ws, db, 'data_reuniao', 'Data da reunião', 'date', '{}'::jsonb, false, 'f'),
    (ws, db, 'proxima_acao', 'Próxima ação', 'text', '{}'::jsonb, false, 'g'),
    -- Tentativas e último contato: é o que separa "ninguém ligou" de
    -- "ligamos cinco vezes e não atende" — duas situações que pedem
    -- coisas opostas e que, sem estes dois campos, parecem iguais no
    -- quadro.
    (ws, db, 'tentativas', 'Tentativas de contato', 'number', '{}'::jsonb, false, 'h'),
    (ws, db, 'ultimo_contato', 'Último contato', 'date', '{}'::jsonb, false, 'i'),
    (ws, db, 'motivo_no_show', 'Motivo do no-show', 'text', '{}'::jsonb, false, 'j'),
    (ws, db, 'estado_onde_mora', 'Estado onde mora', 'text', '{}'::jsonb, false, 'k'),
    (ws, db, 'qualificacao', 'Qualificação', 'long_text', '{}'::jsonb, false, 'l'),
    (ws, db, 'notas', 'Notas', 'long_text', '{}'::jsonb, false, 'm');

  insert into workspace_database_views (workspace_id, database_id, name, type, group_by, layout, position)
  values (ws, db, 'Etapas SDR', 'board', 'etapas_sdr',
          '{"cardSize":"completo"}'::jsonb, 'a')
  returning id into vboard;

  insert into workspace_database_views (workspace_id, database_id, name, type, position)
  values (ws, db, 'Todos os leads', 'table', 'b');

  insert into workspace_blocks (workspace_id, page_id, type, content, position, created_by, updated_by)
  values (ws, pg, 'database',
          jsonb_build_object('databaseId', db::text, 'viewId', vboard::text), 'a', who, who);

  raise notice 'funil SDR criado: page=% db=%', pg, db;
end $$;

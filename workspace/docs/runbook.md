# Runbook — Spark Workspace

Projeto **separado** do Spark Referral Hub: deploy, domínio, variáveis de
ambiente e tabelas próprias. Vive em `workspace/` no repositório
`pedropoleza/test-repo`, com Root Directory apontando para essa pasta.

O único elo com o Hub é o `JWT_SIGNING_KEY`: precisa ser **o mesmo valor**
nos dois projetos, senão o JWT emitido pelo SSO do GHL não valida aqui.

## Variáveis de ambiente

| Variável | Para quê | Obrigatória |
|---|---|---|
| `SUPABASE_URL` | projeto Supabase que guarda o workspace | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | acesso server-side (bypassa RLS) | sim |
| `JWT_SIGNING_KEY` | valida o JWT do SSO — mesmo valor do Hub | sim |
| `ADMIN_URL_SECRET` | acesso de suporte via `?k=` | opcional |
| `WORKSPACE_FIXED_TENANT_ID` | modo de tenant fixo (primeira fase) | opcional |

`SUPABASE_URL` pode apontar para o mesmo projeto do Hub ou para um
dedicado — o código não muda. As tabelas têm prefixo `workspace_` e não
colidem com as do Hub.

## Setup (uma vez, por ambiente)

1. **Migration.** Rodar `db/migrations/0001_workspace_engine.sql` no SQL
   Editor do Supabase. Idempotente (`create table if not exists`).

2. **Bucket de arquivos.** Storage → New bucket:
   - nome: `workspace-files`
   - público: **sim** (leitura); escrita continua só pelo service role

   Sem o bucket, upload de capa e imagem responde `502
   storage_unavailable`. O resto funciona, inclusive capa por
   URL/cor/gradiente.

## Acesso

O servidor tenta três caminhos, nessa ordem:

1. **JWT do SSO do GHL** — `/?session=<jwt>`. A sessão vai para
   `sessionStorage` e some da barra de endereço.
2. **Chave de suporte** — `/?k=$ADMIN_URL_SECRET&tenantId=<locationId>`.
   Entra como `owner` daquele tenant.
3. **Tenant fixo** — se `WORKSPACE_FIXED_TENANT_ID` estiver definida,
   qualquer requisição sem credencial entra como `owner` desse tenant.

Um JWT presente porém inválido é recusado; ele nunca "cai" para o modo
fixo. O `?tenantId=` da query também é ignorado no modo fixo — ele não
serve de porta para outros tenants.

### Modo de tenant fixo — primeira fase

Hoje: `WORKSPACE_FIXED_TENANT_ID = mqO0er6vDQahqWGS1FYJ` (subconta
"Daniely Jones"). É o modo de uma subconta só, sem SSO.

> **Enquanto essa variável existir, quem tiver a URL tem acesso total de
> leitura e escrita ao workspace desse tenant.** Não há login, e a URL
> `.vercel.app` é pública. É uma escolha consciente da primeira fase.

Para encerrar o modo, apague a variável e faça redeploy: o código volta a
exigir SSO ou chave de suporte, sem nenhuma alteração de código.

Para trocar de subconta, mude o valor da variável — o workspace é criado
na primeira visita e o conteúdo antigo continua ligado ao tenant anterior,
intacto.

## Endpoints

```
GET    /api/bootstrap            workspace + árvore + favoritos + recentes
GET    /api/pages?id=<uuid>      página + blocos + breadcrumbs
POST   /api/pages                cria (?action= duplicate|move|archive|restore|favorite|visit)
PATCH  /api/pages?id=<uuid>      título, ícone, capa, largura, visibilidade
DELETE /api/pages?id=<uuid>      exclusão definitiva (exige papel admin)
GET    /api/blocks?pageId=<uuid> blocos da página
POST   /api/blocks               cria (?action= move|duplicate)
PATCH  /api/blocks?action=bulk   autosave do editor
DELETE /api/blocks?id=<uuid>     remove
POST   /api/files                upload (JSON: name, mimeType, dataUrl)
```

## Troubleshooting

**"Não foi possível carregar o workspace" com `db_error`.**
A migration não foi aplicada nesse ambiente. Ver Setup, item 1.

**Tela de "Sessão necessária" mesmo vindo do GHL.**
`JWT_SIGNING_KEY` diferente do Hub. Os dois projetos precisam do mesmo
valor. No modo de tenant fixo essa tela não aparece.

**O workspace abriu vazio depois de mexer nas variáveis.**
Provavelmente `WORKSPACE_FIXED_TENANT_ID` mudou de valor: cada tenant tem
seu próprio workspace. O conteúdo anterior não foi perdido — volte a
variável ao valor antigo para revê-lo.

**Editor preso em "Sem salvar".**
O autosave repete com backoff (1s → 30s) e não descarta o que foi
digitado. Se o erro for 401/403, a sessão do SSO expirou — recarregar com
`?session=` novo resolve. Fora isso, checar logs por `workspace.*`.

**Upload falhando com `storage_unavailable`.**
Bucket `workspace-files` ausente ou privado. Ver Setup, item 2.

**Página sumiu.**
Foi para a lixeira — arquivar leva a subárvore inteira. Sidebar → Lixeira
→ Restaurar. Arquivar nunca apaga; só `DELETE /api/pages`, restrito a
papel admin, apaga de verdade.

## Testes

```bash
npm test    # node --test: fracdex, schema de blocos, rich text, fluxos
```

Os fluxos rodam contra um fake in-memory do Supabase
(`test/helpers/fake-db.js`), sem rede e sem banco.

## Spark Tasks → aba de Tarefas

As tarefas vivem no Spark Tasks. O workspace guarda uma réplica só para
poder listar, filtrar e agrupar junto do resto — alterar tarefa continua
sendo no Spark Tasks.

### Contrato

```
POST https://workspace-engine.vercel.app/api/tasks/inbound
Content-Type: application/json
X-Spark-Signature: sha256=<HMAC-SHA256 hex do corpo, com o segredo combinado>

{
  "id": "...",            // obrigatório: é a chave de idempotência
  "title": "...",
  "status": "open|done",  // outro valor cai para "open"
  "dueDate": "2026-09-10",
  "assignee": "...",
  "contactId": "...",     // id do contato no CRM, se houver
  "url": "https://...",   // só http(s); outros esquemas são descartados
  "updatedAt": "2026-09-01T12:00:00Z"
}
```

Um POST por criação e por mudança de status.

`updatedAt` não é decoração: é o que ordena as entregas. Webhook entrega
fora de ordem, e sem ele um "criada" atrasado apagaria o "concluída" que
chegou antes. Se vier ausente, usamos o instante da chegada — o que
funciona enquanto as entregas vierem em ordem.

### Respostas

| Código | Significado |
|---|---|
| 200 `{outcome:"created"}` | tarefa nova |
| 200 `{outcome:"updated"}` | tarefa existente atualizada |
| 200 `{outcome:"ignored_older"}` | evento mais antigo que o guardado; descartado de propósito |
| 400 `missing_id` / `invalid_json` | corpo sem `id` ou ilegível |
| 401 `invalid_signature` | assinatura ausente ou errada |
| 503 `webhook_not_configured` | falta `SPARK_TASKS_WEBHOOK_SECRET` |

Reentregar o mesmo evento é seguro: a gravação é upsert por `id`.

### Segredo

Gere um segredo forte e guarde o MESMO valor nos dois lados:

```
openssl rand -hex 32
```

- **No workspace**: Vercel → projeto `workspace-engine` → Settings →
  Environment Variables → `SPARK_TASKS_WEBHOOK_SECRET` (Production, e
  Preview se for testar por lá). Marque como sensitive.
- **No Spark Tasks**: na configuração do webhook, como segredo de
  assinatura.

Nunca colar o segredo em chat, commit ou log. Trocar o segredo é trocar
os dois lados: enquanto estiverem diferentes, toda entrega volta 401.

## Listas de CRM (recortes de pipeline/estágio)

Uma lista é uma aba salva com a pergunta "quem está nesta pipeline/neste
estágio". Ela **não guarda os registros** — consulta o CRM a cada
abertura. Congelar a resposta faria a aba envelhecer e virar um relatório
velho com cara de lista viva.

- **Criar**: na seção CRM da navegação, "+ Nova lista" → escolher
  pipeline e, opcionalmente, um estágio. O nome é sugerido e editável.
- **Apólices** nasce pronta, achada pelo nome da pipeline (`/pol[ií]c|ap[oó]lic/i`).
  Se a conta não tiver essa pipeline, a aba simplesmente não aparece.
- **Remover** tira a aba da navegação. Não toca no CRM: as oportunidades
  continuam lá.

O recorte da lista fica **fora** dos filtros da barra de propósito: é o
que define a aba. "Limpar todos" nos filtros não transforma Apólices na
base inteira.

Cada lista tem preferências próprias (colunas, larguras, ordenação):
filtrar Apólices por "Setembro" não mexe na aba de Oportunidades.

Para semear outra lista pronta, acrescente uma entrada em `SEEDS` em
`lib/server/crm-lists.js`. O `seed_key` é o que impede duplicata — o
unique index em `(workspace_id, seed_key)` garante isso no banco, não só
no código.

## Renovações de apólice

A pipeline de apólices desta conta usa os **doze meses como estágios** —
ela já é um calendário de renovação. A aba "Renovações" lê a pipeline
assim e agrupa por prazo: renova este mês, próximo mês, próximos três
meses, parada há muito tempo, mais adiante.

Uma pipeline entra na aba quando **pelo menos 70% dos estágios são meses**
e ela tem 6 ou mais estágios. Duas etapas chamadas "Maio" e "Junho" num
funil de três não viram calendário por acaso. Se a conta tiver mais de uma
pipeline-calendário, aparece um seletor na barra.

Duas medições decidiram o desenho:

- `Contact Next Policy Anniversary` está preenchido em **1 de 300**
  contatos. Uma tela em cima dele mostraria uma apólice. Não é usado.
- `lastStageChangeAt` está em **300 de 300** oportunidades. É daí que sai
  o "parada há N dias", que ordena os cartões dentro de cada faixa.

O calendário anda sempre para a **frente**: uma apólice de março vista em
setembro renova em março do ano que vem — faltam 6 meses, não passaram 6.

"Mais adiante" nasce fechada: num calendário de doze meses ela é sempre a
maioria (46 de 67 hoje), e aberta enterra quem vence agora. Buscando,
todas as faixas abrem — inclusive as que a pessoa fechou à mão.

### O atraso da busca do CRM

O CRM tem duas leituras que discordam. O `PUT` grava e o
`GET /opportunities/:id` já devolve o estágio novo; a busca
(`/opportunities/search`), que alimenta todas as listas, leva **mais de um
minuto** para enxergar. Medido: 40s depois da gravação ainda devolvia o
valor antigo.

Sem tratar isso, mover uma oportunidade e clicar em "Atualizar" traz o
estágio antigo de volta e a alteração parece perdida. Então o que
gravamos fica guardado em `localStorage` por 15 minutos
(`workspace:crmMovimentos`) e é reaplicado por cima da lista, inclusive
depois de recarregar a página. Quando a busca alcança, o registro sai
sozinho — é o que permite que uma alteração feita por outra pessoa no CRM
volte a aparecer.

Passados os 15 minutos, quem manda é o CRM: discordar da busca deixa de
ser "ela está atrasada" e passa a ser "alguém alterou por fora".

## Linha do tempo do contato

Seção da ficha (fechada por padrão) que junta quatro fontes numa lista
só, do mais recente para o mais antigo, agrupada por dia:

| Fonte | O que entra |
|---|---|
| contato | entrou na base (com a origem), dados atualizados |
| oportunidades | criada, mudou de estágio, mudou de status |
| notas do CRM | o texto, sem HTML, resumido em 180 caracteres |
| revisões da ficha | o que foi editado aqui dentro |

Dois cuidados que vêm dos dados:

- Notas existem em **2 de 40** contatos e tarefas do CRM em nenhum. Por
  isso a espinha dorsal são as datas do contato e das oportunidades, que
  estão em 100%.
- Numa oportunidade recém-criada, `createdAt`, `lastStageChangeAt` e
  `lastStatusChangeAt` são o **mesmo instante**. Emitir os três daria
  "criada / mudou de estágio / mudou de status" no mesmo segundo. Só sai
  o que aconteceu mais de um minuto depois da criação.

O autor só aparece quando dá para traduzir o id em nome de gente. A chave
interna da sessão (`fixed:<tenant>`) nunca vai para a tela.

## Modelos de ficha

Cinco roteiros por tipo de negócio, cobrindo as nove pipelines da conta:

| Modelo | Pipelines |
|---|---|
| Apólice | `2- Policies` |
| Recrutamento | `3- Recruiting`, `Carreira` |
| Consultoria | `Aposentadoria`, `Benefício em Vida`, `Blindagem Patrimonial` |
| Prospecção | as duas de `Prospects` |
| Agência | `4- Agency` |

A pipeline **sugere**, não decide: **237 dos 300** contatos não têm
oportunidade nenhuma. Amarrar o modelo à pipeline deixaria 4 de cada 5
fichas sem roteiro.

- A ficha de quem tem oportunidade já nasce com o modelo da pipeline da
  oportunidade **mais recente**.
- Qualquer página recebe qualquer modelo pelo comando `/` → "Modelo de
  ficha". O diálogo mostra o que cada um traz antes de aplicar.

Aplicar **acrescenta** no fim da página; nada do que já está escrito é
apagado. Um modelo destrutivo seria usado uma vez.

Para acrescentar ou mudar um modelo: `src/shared/templates.js`. Os testes
verificam que todo bloco é de um tipo que o editor conhece e que passa
pela normalização da API — um tipo inventado viraria uma pilha de blocos
`unsupported` na página.

## Duas contas, dois deploys

Cada subconta tem o **seu próprio projeto Vercel**, apontando para o
mesmo repositório e a mesma branch. O que muda são as variáveis:

| Projeto | Conta | `WORKSPACE_FIXED_TENANT_ID` |
|---|---|---|
| `workspace-engine` | Daniely Jones | `mqO0er6vDQahqWGS1FYJ` |
| `workspace-samantha` | Samantha | `zFrqRkebl6dO8uI45jjC` |

**Próprio de cada projeto** (nunca copiar entre eles):
`WORKSPACE_FIXED_TENANT_ID`, `GHL_LOCATION_ID`, `SPARK_CRM_ACCOUNT_ID`,
`SPARK_CRM_TOKEN`, `GHL_LOCATION_TOKEN`, `SPARK_TASKS_WEBHOOK_SECRET`,
`ADMIN_URL_SECRET`.

**Compartilhado**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (mesmo
banco, tenants diferentes) e `JWT_SIGNING_KEY` (mesmo valor do Hub, senão
o SSO não valida).

O deploy não precisa de código novo para uma conta a mais: a semeadura
das listas e a detecção da pipeline de renovação saem do CRM daquele
token, então cada instância nasce com as pipelines da sua própria conta.
Se a conta não tiver pipeline de apólices, a aba simplesmente não
aparece.

### Por que o `ADMIN_URL_SECRET` não pode ser o mesmo

Os dois deploys dividem o mesmo Postgres; o que separa as contas é o
`tenant_id`. O caminho de suporte (`?k=<segredo>&tenantId=<id>`) aceita
qualquer tenant — então, com o segredo repetido, a instância de uma conta
lia o workspace da outra. **Isso foi verificado**: antes da trava, a
instância da Samantha devolvia as 12 páginas da Daniely.

Duas medidas, e as duas valem:

1. **Cada projeto tem o seu segredo.** Um vazamento de um lado não abre
   o outro.
2. **Deploy de conta fixa só fala do próprio tenant.** Com
   `WORKSPACE_FIXED_TENANT_ID` definida, um `?tenantId=` diferente é
   recusado com `403 tenant_not_allowed_here` — o deploy passa a ser
   *incapaz* de alcançar outra conta, não só proibido. O modo
   multi-tenant (sem a variável) segue alcançando qualquer tenant, que é
   o que o suporte do Hub precisa.

### Acrescentar mais uma conta

1. Novo projeto na Vercel, mesmo repositório, **Root Directory
   `workspace`**, Production Branch igual à dos outros.
2. Copiar os três compartilhados; gerar os próprios do resto.
3. `WORKSPACE_FIXED_TENANT_ID` = o location id da subconta. O
   `SPARK_CRM_TOKEN` tem que ser um Private Integration Token **gerado
   dentro daquela subconta** — um token de outra subconta responde
   `403 The token does not have access to this location`.
4. Conferir em `/api/crm?action=status`: `ready: true` e o nome da conta
   preenchido.

### Diagnóstico de token

| Resposta | O que é |
|---|---|
| `401 Invalid Private Integration token` | o token não existe ou foi revogado |
| `403 The token does not have access to this location` | o token é válido, mas é de **outra** subconta — ou o location id está errado |
| `403 Forbidden resource` em `/locations/:id` | mesma causa acima |

## Nada de diálogo nativo do navegador

`window.prompt/confirm/alert` não podem aparecer em nenhum campo. Eles
usam a fonte e o tema do sistema, estampam o domínio no título
("workspace-engine.vercel.app says"), não validam, não explicam o que um
valor vazio faz e travam a página — nem dá para consultar o que estava na
tela antes de responder.

Use no lugar:

| Precisa | Use |
|---|---|
| pedir um texto | `openPrompt()` — `src/ui/prompt.js` |
| entregar um link para copiar | `openCopyLink()` — `src/ui/prompt.js` |
| confirmar uma ação | `confirmDialog()` — `src/app.js` |
| escolher entre opções | `openMenu()` — `src/ui/menu.js` |
| formulário com mais de um campo | `openModal()` — `src/ui/menu.js` |

`openPrompt` cobre o que o prompt não cobria: rótulo, dica, validação com
mensagem, e `removeLabel` para quando apagar É a ação — em vez de pedir
que a pessoa adivinhe que "vazio remove o link".

O teste `test/no-native-dialogs.test.js` varre `src`, `api` e `lib` e
falha se algum voltar. Já vazou uma vez depois de terem sido removidos
das seções, por isso a regra é verificada e não só combinada.

## Foto do contato

A foto é o **ícone da página** da ficha (`icon_type: 'url'`), não um campo
separado. Guardar em outro lugar daria duas imagens para a mesma pessoa e
a obrigação de mantê-las em sincronia.

Como ícone, ela aparece sozinha nos três lugares: redonda e grande sobre
a capa, em bolinha na navegação e no breadcrumb. O campo onde se põe fica
no painel do CRM dentro da ficha — enviar um arquivo (até 4 MB, no nosso
storage) ou colar um endereço `https://`. Sem foto, mostramos as iniciais
do nome.

## Navegação: a trilha do botão Voltar

O Voltar anda por uma trilha do app (`trilha` em `src/app.js`), não por
`history.back()`. O histórico do navegador falhava em três frentes:

1. incluía o que veio **antes** do workspace — voltar saía do app;
2. acumulava uma entrada por clique repetido na mesma aba — voltar não
   saía do lugar;
3. o `popstate` só entendia `?crm=` e `?p=`, não `?lista=` — voltar de
   uma lista salva caía na página inicial em vez da seção anterior.

A trilha guarda destinos (`{tipo, id}` com tipo `page`/`crm`/`list`), não
URLs, e nunca repete o topo. O botão fica desabilitado quando não há para
onde voltar, em vez de não fazer nada.

O `pushState` continua existindo para a URL ser compartilhável e o Voltar
do navegador funcionar; abrir o mesmo destino usa `replaceState` para não
criar entrada duplicada. Ao adicionar um novo tipo de tela, acrescente-o
a `destinoAtual()`, `abrirDestino()` e ao `popstate` — os três.

## QR code e PDF da ficha

Toda ficha tem, na seção "Levar a ficha", um QR code e um botão de baixar.

### O que o QR carrega, e por quê

Um QR code carrega **texto, não arquivo**. Um PDF não cabe nele (a
capacidade é de alguns KB) e nenhum leitor de celular renderiza PDF a
partir de bytes crus. O que o código carrega é um endereço que RESPONDE
o PDF como anexo (`Content-Disposition: attachment`): ler o código baixa
o arquivo direto, sem abrir o app e sem pedir login.

O botão "Baixar PDF" usa **o mesmo endereço**. Um link com a chave da
sessão na query só funcionaria para quem já está logado do mesmo jeito, e
seria um segundo caminho para manter em sincronia.

### O token

`workspace_share_tokens` guarda um token aleatório de 32 bytes por ficha.
Ele é a credencial de quem lê o código — dá acesso a UMA coisa, o PDF
daquela ficha, somente leitura.

- **Estável de propósito**: um QR impresso ou colado num contrato não
  pode parar de funcionar porque expirou. Reabrir a ficha reaproveita o
  mesmo token.
- **Revogável**: `POST /api/dossier` com `action=revoke` invalida aquele
  QR; o próximo acesso à ficha emite um novo, sem tocar nos das outras.
- **QUEM TIVER O CÓDIGO VÊ OS DADOS DAQUELE CONTATO.** É a natureza do
  pedido (ler e baixar sem login), e está dito na própria tela.

### O PDF

Gerado com pdf-lib, fonte Helvetica base-14 com WinAnsiEncoding — cobre o
português inteiro sem embutir fonte (embutir custaria ~300 KB por PDF).
Caracteres fora do WinAnsi (emoji, CJK) são removidos antes de escrever:
o pdf-lib estoura ao encontrá-los, e um nome com emoji não pode impedir a
ficha de sair.

Campos personalizados vazios ficam de fora — esta conta tem 115, e listar
todos daria páginas de rótulos vazios. Colunas de escolha saem pelo NOME
da opção, nunca pelo id.

O endereço do QR é montado a partir do host da requisição
(`x-forwarded-proto`/`x-forwarded-host`). Defina `WORKSPACE_PUBLIC_URL`
se o domínio público for diferente do que chega ao servidor — um QR
impresso apontando para o domínio errado não tem conserto.

## Cartão de contato em qualquer página (`/contato`)

O bloco `crm_contact` deixou de ser exclusivo da ficha: o comando
**"/" → "Dados de contato"** insere o cartão de qualquer contato em
qualquer página, com um seletor com busca.

É o que viabiliza dois casos que antes não existiam:

- **comparar** dois contatos lado a lado numa página só;
- uma **capa de família/grupo**: uma página com o cartão de cada pessoa,
  todos ao vivo e editáveis.

O cartão é o mesmo da ficha, então tudo o que vale lá vale aqui — campos
editáveis, oportunidades, mover de estágio.

## Rolagem horizontal das tabelas

Duas formas, porque a barra nativa fica no fim do conteúdo e some da tela
numa tabela de 300 linhas:

- **arrastar a própria tabela** com o mouse, como um mapa. Só vira
  arrasto depois de 5px, para não roubar o clique da célula; e o clique
  que fecha o gesto é engolido, senão soltar em cima de um nome abriria a
  pasta.
- **barra própria colada na base da área visível**, com polegar
  arrastável, clique no trilho para saltar, e setas/Home/End no teclado.

`.ws-db` usa `overflow: clip` e não `hidden`: os dois recortam nos cantos
arredondados, mas `hidden` cria um contêiner de rolagem e **anula o
`position: sticky`** dos descendentes — era o que deixava a barra lá no
fim do conteúdo em vez de na tela.

## Desempenho do carregamento do CRM

Duas mudanças no cliente do CRM, ambas medidas contra a conta real:

**Concorrência.** A fila era estritamente serial, o que anulava todo
`Promise.all` do código — as consultas que montam uma tabela iam uma
atrás da outra e o tempo somava. O limite do CRM é por SEGUNDO, não por
conexão; três de cada vez fica bem abaixo dele e continua protegendo da
rajada que gera 429.

**Memoização das listas que quase não mudam** (campos personalizados,
tags, pipelines, usuários), 5 minutos. Os campos personalizados custam
~2s nesta conta (são 115) e eram pedidos em toda abertura de tabela e de
toda ficha. O memo guarda a PROMESSA, não o resultado: duas chamadas
simultâneas para a mesma lista viravam duas idas ao CRM.

| | antes | depois |
|---|---|---|
| Leads (300) | 1400 ms | 641 ms |
| Oportunidades (300) | 1851 ms | 831 ms |
| Ficha do contato | — | 554 ms |

Como a função serverless é efêmera, o memo é alívio e não fonte de
verdade — por isso o TTL curto e nenhuma invalidação explícita. Os testes
zeram com `__clearGhlCache()`, a mesma válvula do `__setDbClient`.

## Carregando

`renderLoader()` (`src/ui/loader.js`) é o estado de espera: a marca
pulsando mais uma linha do que está acontecendo. As barras cinza serviam
quando a espera era curta; puxar a carteira leva de meio a dois segundos,
e nesse tempo um bloco cinza não diz se o app está trabalhando ou travado.

A mensagem só aparece depois de 450ms — numa resposta rápida ela piscaria
sem ser lida, o que é pior que não ter. Com `prefers-reduced-motion` a
marca fica parada e o texto continua.

## Mover uma pasta entre seções

Arrastar a linha da pasta na navegação e soltar **na seção** (não em cima
de outra página) leva a pasta para lá. É o caminho para uma seção VAZIA:
o arrasto só aceitava soltar sobre um item vizinho, então mover algo para
Privado ou Compartilhado — que começam vazios — era impossível, e a
seção recusava o gesto sem dizer por quê.

A linha compacta dos últimos contatos também arrasta: ela vive num
`.ws-tree__item` com `data-page-id`, que é o que o arrasto reconhece.
Sem isso era preciso expandir a lista inteira só para pegar a ficha que
acabou de ser aberta.

## PDF: capa e foto

O PDF repete o enquadramento da tela — banner no topo, rosto metade sobre
ele, nome embaixo. Quem recebe reconhece a ficha que viu no app, em vez
de um relatório de aparência alheia.

- **Gradiente**: o pdf-lib não tem gradiente, então são 160 faixas
  verticais interpolando as MESMAS paradas que o browser usa
  (`src/shared/cover.js`). Na resolução de impressão não se distinguem de
  um degradê contínuo. Meio ponto de sobreposição entre faixas evita fios
  brancos em alguns leitores.
- **Cor sólida** e **imagem** também, a imagem em `cover`, sem distorcer.
- **Foto**: recorte circular por quatro arcos de Bézier, com anel branco
  por baixo para destacar de qualquer capa. Sem foto, as iniciais — um
  círculo vazio no papel parece imagem que não carregou.

As imagens são buscadas com timeout de 6s e teto de 6 MB, e **falham
soft**: capa ou foto que não carrega não pode impedir a ficha de sair. O
formato é decidido pelos bytes iniciais, não pelo content-type — servidores
mentem com frequência, e o pdf-lib estoura se receber o formato errado.

## Ícones dos diálogos

`renderIconGrid()` (`src/ui/icon-grid.js`) é a grade usada pelos diálogos
de seção e de lista: 74 ícones, a mesma curadoria do seletor completo,
para não haver duas listas divergindo.

Antes cada diálogo abria um menu com oito, e **cada linha mostrava o mesmo
emoji duas vezes** — o menu põe `icon` à esquerda e `label` no corpo, e os
dois recebiam o emoji.

## Editor: por que teclas se perdiam

Dois defeitos independentes, com o mesmo sintoma — digitar rápido depois
do Enter perdia caracteres.

**1. O foco voltava um quadro depois.** Após reconstruir o DOM, o foco era
restaurado num `requestAnimationFrame`. Nesse intervalo o elemento que
tinha o foco já fora destruído e o cursor estava no `<body>`: tudo
digitado ali se perdia. O nó já está no documento quando o render termina,
e `focusBlock` só consulta e foca — o quadro extra não comprava nada.
Agora é síncrono, com o rAF só como reserva para blocos de montagem
assíncrona.

**2. O menu "/" abria com o offset errado.** Ele abre num `setTimeout(0)`
para o "/" já estar no DOM. Numa rajada ("/destaque" de uma vez) esse
callback só rodava depois de TODAS as teclas, e capturava o offset com o
caret no fim — a busca ficava vazia, o menu abria com os 22 comandos e o
Enter escolhia "Texto". Agora o offset é capturado no keydown do "/", e
ao abrir o menu já lê o que foi digatado no intervalo.

## Associações entre contatos

`/contato` dentro da ficha de alguém pergunta o parentesco e liga os dois.
15 rótulos (cônjuge, filho, pai/mãe, irmão, avô, sobrinho, sócio,
indicou…) em `src/shared/relations.js`.

**A associação é gravada nos DOIS sentidos**, com o rótulo invertido:
marcar "João é filho de Maria" faz a ficha de Maria mostrar João como
filho e a de João mostrar Maria como pai/mãe. Ninguém repete o gesto do
outro lado, e a consulta é uma leitura direta por contato, sem OR nem
UNION.

A simetria é do SERVIDOR: se dependesse de duas chamadas do browser, uma
falha de rede no meio deixaria o vínculo existindo de um lado só — pior
que a ausência dele, porque ninguém procura o erro no lado que não mostra
nada. Desfazer também apaga os dois.

O parentesco vive em `workspace_contact_relations` (migration 0007), não
no bloco: o cartão numa página é apresentação, e guardar o vínculo nele
faria a informação existir só naquela página.

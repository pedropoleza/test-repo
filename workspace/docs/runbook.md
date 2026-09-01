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

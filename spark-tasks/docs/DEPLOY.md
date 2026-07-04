# Deploy & URLs de configuração (GHL + Vercel)

## Domínio de produção (canônico)

**`https://spark-tasks-sigma.vercel.app`**

Projeto Vercel: `spark-tasks` · Root Directory: `spark-tasks/` (este diretório
do repo) · Framework: Next.js · Package manager: pnpm.

> Domínio real atribuído pelo Vercel (o `spark-tasks.vercel.app` já estava em
> uso por outra conta). Os paths são fixos no código e o callback OAuth resolve
> o domínio dinamicamente (`url.origin`) — um domínio custom futuro não exige
> recompilar nada, só atualizar os campos no app GHL.

## URLs para configurar no app GHL (Developer Portal)

| Campo no app GHL | URL exata |
|---|---|
| **Redirect URL** (OAuth) | `https://spark-tasks-sigma.vercel.app/api/oauth/callback` |
| **Custom Page URL** (iframe/SSO) | `https://spark-tasks-sigma.vercel.app/` |
| **Webhook URL** (opcional) | `https://spark-tasks-sigma.vercel.app/api/webhooks/ghl` |
| Healthcheck (verificação) | `https://spark-tasks-sigma.vercel.app/api/health` |

Escopos a conceder (plan §4.3): `locations.readonly`, `users.readonly`,
`contacts.readonly`, `contacts.write` + OAuth/locationToken.

## Fluxo de instalação (uma vez, nível agency)

1. Configure as URLs acima e os escopos no app.
2. Adicione as env vars no projeto Vercel (ver `.env.example`).
3. Aplique as migrations no Supabase (em ordem):
   `drizzle/0000_init.sql` → `drizzle/0001_oauth.sql` → `drizzle/0002_writeback.sql`,
   e rode `drizzle/verify_rls.sql` (esperado: `OK read-isolation` + `OK write-isolation`).
4. Faça a instalação OAuth do app na agency — o GHL redireciona para
   `/api/oauth/callback`, que captura e grava o Company token criptografado.
5. Adicione a Custom Page numa location de teste e abra o app — o SSO abre a
   sessão e o board carrega.

## Env vars (Vercel)

`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GHL_APP_CLIENT_ID`,
`GHL_APP_CLIENT_SECRET`, `GHL_SSO_KEY`, `GHL_COMPANY_ID`, `ENCRYPTION_KEY`,
`SESSION_SECRET` e, opcionais: `TRIGGER_SECRET_KEY` (Trigger.dev — quando
provisionado o write-back migra para lá), `GHL_WRITEBACK_TAG` (default
`tarefa-concluida`).

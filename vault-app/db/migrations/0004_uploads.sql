-- 0004_uploads.sql
-- Upload de arquivos direto pela pasta do contato (MVP): guarda o binário no
-- próprio Postgres (bytea) via o role dv_app — sem storage externo por enquanto
-- (D2 decide migrar para object storage / URLs assinadas depois).
--
-- Aplicado no projeto Supabase: Sparkleads OS (nsqwgjbgcdqyzozyaltz).

alter table document_vault.documents
  add column if not exists content bytea,
  add column if not exists uploaded_by text;

-- Passa a aceitar source='upload' (arquivo enviado manualmente pela pasta).
alter table document_vault.documents drop constraint if exists documents_source_check;
alter table document_vault.documents add constraint documents_source_check
  check (source in ('media', 'conversation', 'form', 'upload'));

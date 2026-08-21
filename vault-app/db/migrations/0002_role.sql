-- 0003_document_vault_role.sql
-- Usuário de banco dedicado do Cofre (menor privilégio).
--
-- Em vez de usar a service_role key (que enxerga o projeto inteiro), o Cofre
-- conecta com um role que SÓ alcança o schema document_vault. A conexão é
-- direta via pooler (Supavisor), sem PostgREST — por isso não precisa expor
-- o schema no Data API.
--
-- A SENHA NÃO fica no repo. Setar via psql/MCP com um valor forte e usar a
-- string resultante como VAULT_DATABASE_URL na Vercel:
--   postgresql://dv_app.<project_ref>:<senha>@aws-0-<region>.pooler.supabase.com:6543/postgres
--
-- Aplicado no projeto Supabase: Sparkleads OS (nsqwgjbgcdqyzozyaltz).
--
-- Geração da senha + criação (rodar com a senha injetada, não commitar o valor):
--   create role dv_app with login password '<SENHA_FORTE>';

-- Privilégios: só o schema do Cofre.
grant usage on schema document_vault to dv_app;
grant select, insert, update, delete on all tables in schema document_vault to dv_app;
grant usage, select on all sequences in schema document_vault to dv_app;
alter default privileges in schema document_vault
  grant select, insert, update, delete on tables to dv_app;
alter default privileges in schema document_vault
  grant usage, select on sequences to dv_app;

-- RLS continua ligado; dv_app ganha policy permissiva (só ele alcança o schema).
-- Uma policy por tabela do schema:
--   create policy dv_app_all on document_vault.<tabela>
--     to dv_app using (true) with check (true);
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'document_vault' loop
    execute format('drop policy if exists dv_app_all on document_vault.%I', t.tablename);
    execute format(
      'create policy dv_app_all on document_vault.%I to dv_app using (true) with check (true)',
      t.tablename);
  end loop;
end $$;

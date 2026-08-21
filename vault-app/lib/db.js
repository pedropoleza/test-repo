/**
 * Conexão Postgres DEDICADA do Cofre de Documentos.
 *
 * Separação real + menor privilégio: conecta com o usuário `dv_app`, que só
 * enxerga o schema `document_vault` no projeto Sparkleads OS. Não usa a
 * service_role key (que veria o projeto inteiro) nem o PostgREST.
 *
 * Env var (Vercel):
 *   DATABASE_URL — string de conexão do pooler (Supavisor, transaction
 *   mode, porta 6543) com o usuário dv_app. Ex.:
 *   postgresql://dv_app.<ref>:<senha>@aws-0-us-east-1.pooler.supabase.com:6543/postgres
 *
 * postgres.js com prepare:false (exigido pelo pooler em transaction mode) e
 * max:1 (serverless). Singleton por warm container.
 */
import postgres from "postgres";

let _sql = null;

export function sql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  _sql = postgres(url, {
    ssl: "require",
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return _sql;
}

/** true se as env vars mínimas do Cofre estão presentes. */
export function vaultConfigured() {
  return !!process.env.DATABASE_URL;
}

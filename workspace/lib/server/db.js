/**
 * Supabase server client do Workspace.
 *
 * Projeto Vercel separado ⇒ variáveis de ambiente próprias. Apontar
 * SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY para o projeto Supabase que o
 * Workspace deve usar — pode ser o mesmo do Hub de Indicações ou um
 * dedicado, sem mudar uma linha de código.
 *
 * Usa SERVICE_ROLE_KEY (bypassa RLS) — só pode ser importado de funções
 * que rodam no servidor (/api/**). Nunca exponha essa key ao browser.
 */
import { createClient } from "@supabase/supabase-js";

let _client = null;
let _override = null;

/**
 * Injeta um client fake nos testes. Fora de teste ninguém chama isso —
 * o caminho de produção continua sendo o singleton abaixo.
 */
export function __setDbClient(client) {
  _override = client;
}

export function db() {
  if (_override) return _override;
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "public" },
    global: {
      headers: { "x-application": "spark-workspace" },
    },
  });
  return _client;
}

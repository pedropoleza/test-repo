/**
 * Cliente Supabase DEDICADO do Cofre de Documentos.
 *
 * Separação real: aponta para o projeto e schema próprios do Cofre
 * (Sparkleads OS → schema `document_vault`), com credenciais próprias —
 * NUNCA reusa o cliente do Referral Hub (lib/server/db.js).
 *
 * Env vars (Vercel):
 *   VAULT_SUPABASE_URL               — URL do projeto host (Sparkleads OS)
 *   VAULT_SUPABASE_SERVICE_ROLE_KEY  — service role key do mesmo projeto
 *
 * IMPORTANTE: o schema `document_vault` precisa estar em "Exposed schemas"
 * (Settings → API) do projeto, senão o PostgREST recusa as queries.
 *
 * Singleton por warm container.
 */
import { createClient } from "@supabase/supabase-js";

let _client = null;

export function vaultDb() {
  if (_client) return _client;

  const url = process.env.VAULT_SUPABASE_URL;
  const key = process.env.VAULT_SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("VAULT_SUPABASE_URL not set");
  if (!key) throw new Error("VAULT_SUPABASE_SERVICE_ROLE_KEY not set");

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "document_vault" },
    global: { headers: { "x-application": "spark-document-vault" } },
  });
  return _client;
}

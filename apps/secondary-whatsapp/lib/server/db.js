/**
 * Supabase server client.
 *
 * Usa SERVICE_ROLE_KEY (bypassa RLS) — só pode ser importado de
 * funções que rodam no servidor (/api/**). Não é seguro expor essa
 * key ao browser.
 *
 * Singleton por warm container; o client é leve e seguro pra reusar.
 */
import { createClient } from "@supabase/supabase-js";

let _client = null;

export function db() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db:   { schema: "public" },
    global: {
      headers: { "x-application": "secondary-whatsapp" },
    },
  });
  return _client;
}

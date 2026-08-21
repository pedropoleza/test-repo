/**
 * GET /api/documents — arquivos salvos por contato, na location da sessão.
 *
 * Auth: JWT curto de /api/session (header x-vault-session ou ?session=).
 * Escopo por location vem do JWT — nunca da query.
 *
 * Devolve os documentos (espelhados do GHL + enviados manualmente) já agrupáveis
 * por contato no front. Sem taxonomia/checklist — o Cofre só apresenta o que
 * está salvo.
 */
import { verify as jwtVerify } from "../lib/jwt.js";
import { sql, vaultConfigured } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!vaultConfigured()) return res.status(503).json({ error: "not_configured" });

  const token = req.headers["x-vault-session"] || req.query?.session;
  if (!token) return res.status(401).json({ error: "missing_session" });
  let claims;
  try { claims = jwtVerify(token); } catch (err) { return res.status(401).json({ error: "invalid_session", reason: err.message }); }
  const locationId = claims.locationId;
  if (!locationId) return res.status(403).json({ error: "no_location" });

  try {
    const documents = await sql()`
      select id, contact_id, contact_name, service_key, source, status,
             filename, mime, size_bytes, (content is not null) as has_content,
             coalesce(created_at_ghl, created_at) as at
      from document_vault.documents
      where location_id = ${locationId}
      order by coalesce(created_at_ghl, created_at) desc`;

    return res.status(200).json({ locationId, documents });
  } catch (err) {
    console.error("[documents] query failed:", err.message || err);
    return res.status(500).json({ error: "query_failed" });
  }
}

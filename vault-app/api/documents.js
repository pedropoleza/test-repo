/**
 * GET /api/documents — dados do Cofre para a location da sessão.
 *
 * Auth: JWT curto emitido por /api/session (header x-vault-session ou ?session=).
 * Devolve a taxonomia (serviços + tipos esperados) e os documentos espelhados
 * da location. O front monta as pastas (por contato) e o "o que falta".
 *
 * Escopo por location vem do JWT — nunca da query — então uma location não vê
 * documento de outra.
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
  try {
    claims = jwtVerify(token);
  } catch (err) {
    return res.status(401).json({ error: "invalid_session", reason: err.message });
  }
  const locationId = claims.locationId;
  if (!locationId) return res.status(403).json({ error: "no_location" });

  try {
    // Taxonomia: seed global (location_id null) + overrides desta location.
    const services = await sql()`
      select s.service_key, s.name_pt, s.name_en, s.sort,
             coalesce(json_agg(
               json_build_object('doc_key', t.doc_key, 'label_pt', t.label_pt,
                                 'label_en', t.label_en, 'required', t.required, 'sort', t.sort)
               order by t.sort
             ) filter (where t.id is not null), '[]') as docs
      from document_vault.services s
      left join document_vault.doc_types t on t.service_id = s.id
      where s.location_id is null or s.location_id = ${locationId}
      group by s.service_key, s.name_pt, s.name_en, s.sort
      order by s.sort`;

    const documents = await sql()`
      select contact_id, contact_name, service_key, doc_key, source, status,
             contact_resolution, mime, size_bytes, created_at_ghl
      from document_vault.documents
      where location_id = ${locationId}
      order by created_at_ghl desc nulls last, created_at desc`;

    return res.status(200).json({
      locationId,
      taxonomy: { services },
      documents,
    });
  } catch (err) {
    console.error("[documents] query failed:", err.message || err);
    return res.status(500).json({ error: "query_failed" });
  }
}

/**
 * GET /api/file?id=<uuid> — baixa/exibe um arquivo salvo na pasta.
 *
 * Auth: JWT da sessão (header x-vault-session ou ?session=). O escopo é sempre
 * a location do JWT — uma location não acessa arquivo de outra.
 *
 * Só serve arquivos que têm binário guardado (source='upload' no MVP). Os
 * espelhados do GHL (status pending, sem content) ainda não têm download
 * próprio até o D2 (storage + URL assinada).
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

  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: "missing_id" });

  try {
    const rows = await sql()`
      select filename, mime, content
      from document_vault.documents
      where id = ${id} and location_id = ${locationId}
      limit 1`;
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "not_found" });
    if (!row.content) return res.status(409).json({ error: "no_content", reason: "arquivo ainda não espelhado (D2)" });

    // Auditoria do acesso (best-effort).
    sql()`insert into document_vault.audit_log (event_type, actor, location_id, document_id, summary)
      values ('vault.document.downloaded', ${claims.userId || "user"}, ${locationId}, ${id}, ${row.filename})`
      .catch(() => {});

    const buf = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(row.filename || "arquivo")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(buf);
  } catch (err) {
    console.error("[file] query failed:", err.message || err);
    return res.status(500).json({ error: "query_failed" });
  }
}

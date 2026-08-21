/**
 * POST /api/upload — adiciona um arquivo à pasta de um contato.
 *
 * Auth: JWT da sessão do Custom Page (header x-vault-session).
 * Body JSON: { contactId, contactName?, filename, mime, dataBase64 }.
 *
 * MVP de storage: guarda o binário em document_vault.documents.content (bytea)
 * via dv_app. Limite prático do corpo no Vercel ~4.5MB (base64 infla ~33%),
 * então o front limita o arquivo a ~3.5MB. Object storage / URLs assinadas = D2.
 */
import { randomUUID, createHash } from "node:crypto";
import { verify as jwtVerify } from "../lib/jwt.js";
import { sql, vaultConfigured } from "../lib/db.js";

const MAX_BYTES = 4 * 1024 * 1024; // 4MB

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!vaultConfigured()) return res.status(503).json({ error: "not_configured" });

  const token = req.headers["x-vault-session"];
  if (!token) return res.status(401).json({ error: "missing_session" });
  let claims;
  try { claims = jwtVerify(token); } catch (err) { return res.status(401).json({ error: "invalid_session", reason: err.message }); }
  const locationId = claims.locationId;
  if (!locationId) return res.status(403).json({ error: "no_location" });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const { contactId, contactName, filename, mime, dataBase64 } = body;
  if (!contactId) return res.status(400).json({ error: "missing_contact" });
  if (!filename || !dataBase64) return res.status(400).json({ error: "missing_file" });

  let buf;
  try { buf = Buffer.from(String(dataBase64), "base64"); } catch { return res.status(400).json({ error: "bad_base64" }); }
  if (!buf.length) return res.status(400).json({ error: "empty_file" });
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: "file_too_large", max_bytes: MAX_BYTES });

  const checksum = createHash("sha256").update(buf).digest("hex");
  const sourceRef = randomUUID();

  try {
    const rows = await sql()`
      insert into document_vault.documents
        (location_id, contact_id, contact_name, source, source_ref, contact_resolution,
         filename, mime, size_bytes, checksum, status, content, uploaded_by, created_at_ghl)
      values
        (${locationId}, ${contactId}, ${contactName || null}, 'upload', ${sourceRef}, 'manual',
         ${filename}, ${mime || "application/octet-stream"}, ${buf.length}, ${checksum}, 'mirrored',
         ${buf}, ${claims.userId || null}, now())
      returning id, filename, mime, size_bytes, source, status, created_at`;
    const doc = rows[0];

    // Auditoria do upload (best-effort).
    sql()`insert into document_vault.audit_log (event_type, actor, location_id, document_id, summary)
      values ('vault.document.uploaded', ${claims.userId || "user"}, ${locationId}, ${doc.id}, ${filename})`
      .catch(() => {});

    return res.status(200).json({ ok: true, document: doc });
  } catch (err) {
    console.error("[upload] insert failed:", err.message || err);
    return res.status(500).json({ error: "upload_failed" });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

/**
 * GET/POST /api/cron/vault-harvest
 *
 * Coração do Cofre: poll incremental das fontes do GHL para espelhar documentos.
 * O GHL não tem webhook de "documento adicionado", então o cron é a fonte da
 * verdade (o webhook, quando houver evento de mídia, só antecipa).
 *
 * Estado atual (esqueleto):
 *   - media (Media Library): captura incremental por createdAt → grava registros
 *     em document_vault.documents com status 'pending'. O download + upload no
 *     storage seguro é a próxima etapa (D2).
 *   - conversation (WhatsApp) e form (FILE_UPLOAD): TODO (D1 fallback).
 *
 * Protegido igual aos outros crons: header x-vercel-cron OU CRON_SECRET.
 * Tolerante: se as env vars do Cofre ainda não existem, responde 200
 * {configured:false} em vez de estourar (evita ruído de cron vermelho).
 */
import { timingSafeEqual } from "node:crypto";
import { sql, vaultConfigured } from "../../lib/db.js";
import { getVaultLocationToken } from "../../lib/ghl-token.js";
import { encrypt } from "../../lib/crypto.js";
import { listMediaFiles, normalizeMediaFile } from "../../lib/ghl.js";

export const config = { maxDuration: 60 };

function safeEq(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const isVercelCron = !!req.headers["x-vercel-cron"];
  if (!isVercelCron && !safeEq(process.env.CRON_SECRET, req.headers["x-cron-secret"])) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // Ainda não configurado → no-op silencioso (não é erro).
  if (!vaultConfigured()) {
    return res.status(200).json({ ok: false, configured: false, reason: "vault_env_missing" });
  }

  let installs;
  try {
    installs = await sql()`
      select location_id from document_vault.installations where status = 'active'`;
  } catch (err) {
    console.error("[vault-harvest] list installations failed:", err.message || err);
    return res.status(500).json({ error: "list_failed", message: err.message });
  }

  if (!installs.length) {
    return res.status(200).json({ ok: true, locations: 0, note: "nenhuma installation ativa" });
  }

  const summary = [];
  for (const inst of installs) {
    try {
      const media = await harvestMedia(inst.location_id);
      summary.push({ location: inst.location_id, media });
    } catch (err) {
      console.warn("[vault-harvest] media failed:", inst.location_id, err.message || err);
      summary.push({ location: inst.location_id, error: err.message || String(err) });
    }
    // TODO: harvestConversations(inst.location_id) — anexos de WhatsApp (D1 fallback)
    // TODO: harvestFormUploads(inst.location_id) — campo FILE_UPLOAD
  }

  return res.status(200).json({ ok: true, locations: installs.length, summary });
}

/**
 * Poll incremental da Media Library de uma location.
 * Lê o cursor (createdAt), busca só o que veio depois, grava 'pending' e avança.
 */
async function harvestMedia(locationId) {
  const st = await sql()`
    select last_cursor from document_vault.sync_state
    where location_id = ${locationId} and source = 'media' limit 1`;
  const since = st[0]?.last_cursor || null;

  const token = await getVaultLocationToken(locationId);
  const files = await listMediaFiles(token, locationId, { limit: 100 });

  let maxCursor = since;
  const rows = [];
  for (const f of files) {
    const n = normalizeMediaFile(f);
    if (!n.source_ref) continue;
    if (since && n.created_at_ghl && n.created_at_ghl <= since) continue; // incremental
    rows.push({
      location_id: locationId,
      contact_id: n.contact_id,
      contact_resolution: n.contact_resolution,
      source: "media",
      source_ref: n.source_ref,
      ghl_url_enc: n.url ? encrypt(n.url) : null, // nunca a URL em claro
      filename: n.filename,
      mime: n.mime,
      size_bytes: n.size_bytes,
      status: "pending", // download + storage seguro: D2
      created_at_ghl: n.created_at_ghl,
    });
    if (!maxCursor || (n.created_at_ghl && n.created_at_ghl > maxCursor)) {
      maxCursor = n.created_at_ghl;
    }
  }

  let captured = 0;
  if (rows.length) {
    const cols = [
      "location_id", "contact_id", "contact_resolution", "source", "source_ref",
      "ghl_url_enc", "filename", "mime", "size_bytes", "status", "created_at_ghl",
    ];
    await sql()`
      insert into document_vault.documents ${sql()(rows, ...cols)}
      on conflict (location_id, source, source_ref) do nothing`;
    captured = rows.length;
  }

  await sql()`
    insert into document_vault.sync_state (location_id, source, last_cursor, last_run_at)
    values (${locationId}, 'media', ${maxCursor}, ${new Date().toISOString()})
    on conflict (location_id, source) do update set
      last_cursor = excluded.last_cursor,
      last_run_at = excluded.last_run_at`;

  return { seen: files.length, captured, cursor: maxCursor };
}

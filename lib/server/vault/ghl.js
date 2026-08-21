/**
 * Helpers da API GHL para o Cofre — as 3 fontes de captura do spec.
 *
 * Fonte da verdade do dono do documento:
 *   - media (Media Library / "Add to documents"): D1 — confirmar se o objeto
 *     traz contactId. Se não trouxer, cai no fallback por conversa.
 *   - conversation (anexo de WhatsApp): messageId → conversationId → contactId.
 *   - form (campo FILE_UPLOAD): valor do custom field = URL, dono nativo.
 */
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export async function ghlGet(path, token, params = {}) {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: "application/json" },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`GHL ${r.status} ${path}: ${body.slice(0, 180)}`);
  }
  return r.json();
}

/**
 * Media Library — o gatilho do "Add to documents". Ordena por createdAt asc
 * para o poll incremental. altId/altType escopam na location.
 * D1: validar se cada item traz contactId no objeto.
 */
export async function listMediaFiles(token, locationId, { limit = 100, offset = 0 } = {}) {
  const json = await ghlGet("/medias/files", token, {
    altId: locationId,
    altType: "location",
    sortBy: "createdAt",
    sortOrder: "asc",
    limit,
    offset,
  });
  return json?.files || json?.medias || [];
}

/**
 * Normaliza um item de media para o shape de vault_documents (parcial).
 * O download + upload no storage seguro é etapa seguinte (D2).
 */
export function normalizeMediaFile(f) {
  const createdAt = f.createdAt || f.dateAdded || f.createdAtDate || null;
  const url = f.url || f.fileUrl || f.link || null;
  const contactId = f.contactId || f.contact_id || null; // D1
  return {
    source_ref: String(f.id || f._id || f.fileId || url || ""),
    contact_id: contactId,
    contact_resolution: contactId ? "media_native" : "unresolved",
    url,
    filename: f.name || f.fileName || f.originalName || null,
    mime: f.mimeType || f.contentType || null,
    size_bytes: f.size || f.fileSize || null,
    created_at_ghl: createdAt,
  };
}

// TODO (D1 fallback): listConversations/listMessages → extrair anexos de WhatsApp.
// TODO: form FILE_UPLOAD → ler custom field via GET /contacts/{id}.

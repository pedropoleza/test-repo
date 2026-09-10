/**
 * Documentos do cliente na ficha (F2).
 *
 * O arquivo já é gravado por api/files (bucket + metadata); aqui só se
 * lê e se remove o que está atrelado a um contato. O elo é
 * source_external_id = id do contato, com source 'contact_doc'.
 */
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { WorkspaceError } from "./context.js";
import { normalizarCategoria } from "../../src/shared/documents.js";

const BUCKET = "workspace-files";
const CAMPOS = "id,public_url,mime_type,byte_size,original_name,category,service_code,created_at";

/** Os documentos de um contato, do mais recente para o mais antigo. */
export async function listContactDocuments(ctx, contactId) {
  if (!contactId) throw new WorkspaceError(400, "missing_contactId");
  const { data, error } = await db()
    .from("workspace_files")
    .select(CAMPOS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("source", "contact_doc")
    .eq("source_external_id", String(contactId))
    .order("created_at", { ascending: false });
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });

  return (data || []).map((f) => ({
    id: f.id,
    url: f.public_url,
    nome: f.original_name,
    mime: f.mime_type,
    bytes: f.byte_size,
    categoria: normalizarCategoria(f.category),
    serviceCode: f.service_code || null,
    criadoEm: f.created_at,
  }));
}

/**
 * Remove um documento do contato: primeiro o registro (o tenant vem do
 * token, nunca do corpo), depois o arquivo do bucket. Some do bucket é
 * best-effort — se falhar, o registro já saiu e a ficha não mostra mais.
 */
export async function deleteContactDocument(ctx, id) {
  if (!id) throw new WorkspaceError(400, "missing_id");
  const { data: row, error: readErr } = await db()
    .from("workspace_files")
    .select("id,storage_key")
    .eq("workspace_id", ctx.workspaceId)
    .eq("source", "contact_doc")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new WorkspaceError(500, "db_error", { detail: readErr.message });
  if (!row) throw new WorkspaceError(404, "document_not_found");

  const { error: delErr } = await db()
    .from("workspace_files")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id);
  if (delErr) throw new WorkspaceError(500, "db_error", { detail: delErr.message });

  try {
    await db().storage.from(BUCKET).remove([row.storage_key]);
  } catch { /* o registro já saiu; o objeto órfão é limpeza, não erro */ }
  return true;
}

/**
 * Grava um arquivo gerado pelo servidor como documento de um contato.
 *
 * Mesmo caminho do upload da ficha (bucket + linha em workspace_files),
 * mas para bytes que nascem aqui dentro — hoje, o PDF assinado pelo
 * cliente no portal. `ctx` aqui é só `{ workspaceId, userKey }`: quem
 * assina não tem sessão, o tenant vem do token do pedido.
 */
export async function salvarDocumentoDoContato(ctx, {
  contactId, bytes, mimeType = "application/pdf",
  nome = "documento.pdf", categoria = "contrato", serviceCode = null,
} = {}) {
  if (!contactId) throw new WorkspaceError(400, "missing_contactId");
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!buffer.length) throw new WorkspaceError(400, "empty_file");

  const safeName = String(nome).replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const storageKey = `${ctx.workspaceId}/${randomUUID()}-${safeName}`;
  const storage = db().storage.from(BUCKET);

  const { error: upErr } = await storage.upload(storageKey, buffer, {
    contentType: mimeType, upsert: false,
  });
  if (upErr) throw new WorkspaceError(502, "storage_unavailable", { detail: upErr.message });

  const { data: pub } = storage.getPublicUrl(storageKey);
  const { data, error } = await db()
    .from("workspace_files")
    .insert({
      workspace_id: ctx.workspaceId,
      storage_key: storageKey,
      public_url: pub?.publicUrl || null,
      mime_type: mimeType,
      byte_size: buffer.length,
      original_name: safeName,
      source: "contact_doc",
      source_external_id: String(contactId).slice(0, 120),
      category: normalizarCategoria(categoria),
      service_code: serviceCode ? String(serviceCode).slice(0, 60) : null,
      created_by: ctx.userKey || "portal",
    })
    .select(CAMPOS)
    .maybeSingle();
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return data;
}

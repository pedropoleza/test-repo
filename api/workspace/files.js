/**
 * POST /api/workspace/files — upload de imagem/arquivo do workspace.
 *
 * Storage é NOSSO (Supabase Storage), nunca uma URL emprestada de outro
 * serviço (§53). O bucket é público para leitura; a chave inclui o
 * workspace_id, então um arquivo não vaza entre tenants por adivinhação
 * de nome (uuid + timestamp).
 *
 * Corpo: JSON { name, mimeType, dataUrl }  — o limite de body da Vercel
 * (≈4.5MB) é o teto prático; o cliente valida antes de enviar.
 */
import { randomUUID } from "node:crypto";
import { db } from "../../lib/server/db.js";
import {
  resolveContext,
  requireRole,
  sendError,
  WorkspaceError,
} from "../../lib/server/workspace/context.js";
import { log } from "../../lib/server/log.js";

const BUCKET = "workspace-files";
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "video/mp4", "video/webm",
  "application/pdf", "text/plain", "text/csv",
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const ctx = await resolveContext(req);
    requireRole(ctx, "editor");

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { name, mimeType, dataUrl } = body;

    if (!dataUrl || typeof dataUrl !== "string") {
      throw new WorkspaceError(400, "missing_file");
    }
    if (!ALLOWED.has(mimeType)) {
      throw new WorkspaceError(415, "unsupported_media_type", { mimeType });
    }

    const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) throw new WorkspaceError(400, "empty_file");
    if (buffer.length > MAX_BYTES) {
      throw new WorkspaceError(413, "file_too_large", { maxBytes: MAX_BYTES });
    }

    const safeName = String(name || "arquivo").replace(/[^\w.\-]+/g, "_").slice(0, 120);
    const storageKey = `${ctx.workspaceId}/${randomUUID()}-${safeName}`;

    const storage = db().storage.from(BUCKET);
    const { error: upErr } = await storage.upload(storageKey, buffer, {
      contentType: mimeType,
      upsert: false,
    });
    if (upErr) {
      // Bucket ausente é erro de setup, não do usuário — precisa aparecer
      // como tal no runbook em vez de virar "falha ao enviar".
      log.error("workspace.file.upload_failed", { error: upErr.message, bucket: BUCKET });
      throw new WorkspaceError(502, "storage_unavailable", { detail: upErr.message });
    }

    const { data: pub } = storage.getPublicUrl(storageKey);
    const publicUrl = pub?.publicUrl || null;

    const { data: row, error } = await db()
      .from("workspace_files")
      .insert({
        workspace_id: ctx.workspaceId,
        storage_key: storageKey,
        public_url: publicUrl,
        mime_type: mimeType,
        byte_size: buffer.length,
        original_name: safeName,
        source: "upload",
        created_by: ctx.userKey,
      })
      .select("id,public_url,mime_type,byte_size,original_name")
      .maybeSingle();
    if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });

    log.info("workspace.file.uploaded", {
      workspaceId: ctx.workspaceId,
      fileId: row.id,
      bytes: buffer.length,
    });
    return res.status(201).json({ file: row });
  } catch (err) {
    return sendError(res, err);
  }
}

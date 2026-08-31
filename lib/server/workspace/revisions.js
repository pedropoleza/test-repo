/**
 * Histórico incremental (§35). Uma linha por operação, com `before` e
 * `after` do que mudou — não um snapshot da página a cada tecla.
 *
 * Nunca lança: histórico não pode derrubar uma edição.
 */
import { db } from "../db.js";
import { log } from "../log.js";

export async function recordRevision(ctx, {
  pageId = null,
  entityType,
  entityId = null,
  operation,
  before = null,
  after = null,
}) {
  try {
    await db().from("workspace_revisions").insert({
      workspace_id: ctx.workspaceId,
      page_id: pageId,
      entity_type: entityType,
      entity_id: entityId,
      operation,
      actor: ctx.userKey,
      before,
      after,
    });
  } catch (err) {
    log.warn("workspace.revision.write_failed", {
      operation,
      entityType,
      error: err.message,
    });
  }
}

export async function listRevisions(ctx, pageId, limit = 50) {
  const { data, error } = await db()
    .from("workspace_revisions")
    .select("id,entity_type,entity_id,operation,actor,created_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("page_id", pageId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 200));
  if (error) throw new Error(error.message);
  return data || [];
}

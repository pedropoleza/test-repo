/**
 * Repositório de blocos.
 *
 * Ordenação por fractional indexing: mover um bloco é um UPDATE de uma
 * linha, independente do tamanho da página (§11).
 */
import { db } from "./db.js";
import { keyBetween, byPosition } from "../../src/shared/fracdex.js";
import { WorkspaceError } from "./context.js";
import { recordRevision } from "./revisions.js";
import {
  isBlockType,
  blockSpec,
  normalizeBlockContent,
  normalizeBlockProps,
} from "../../src/shared/blocks.js";

const BLOCK_FIELDS =
  "id,page_id,tab_id,parent_block_id,type,content,props,position," +
  "source,source_external_id,created_by,updated_by,created_at,updated_at";

function fail(error, code = "db_error") {
  throw new WorkspaceError(500, code, { detail: error.message });
}

export async function listBlocks(ctx, pageId) {
  const { data, error } = await db()
    .from("workspace_blocks")
    .select(BLOCK_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("page_id", pageId);
  if (error) fail(error);
  return (data || []).sort(byPosition);
}

export async function getBlock(ctx, blockId) {
  const { data, error } = await db()
    .from("workspace_blocks")
    .select(BLOCK_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", blockId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new WorkspaceError(404, "block_not_found");
  return data;
}

async function siblings(ctx, pageId, parentBlockId) {
  let query = db()
    .from("workspace_blocks")
    .select("id,position")
    .eq("workspace_id", ctx.workspaceId)
    .eq("page_id", pageId);
  query = parentBlockId
    ? query.eq("parent_block_id", parentBlockId)
    : query.is("parent_block_id", null);
  const { data, error } = await query;
  if (error) fail(error);
  return (data || []).sort(byPosition);
}

async function positionFor(ctx, { pageId, parentBlockId, afterId, beforeId, excludeId }) {
  const list = (await siblings(ctx, pageId, parentBlockId)).filter((b) => b.id !== excludeId);
  if (!list.length) return keyBetween(null, null);

  if (afterId) {
    const idx = list.findIndex((b) => b.id === afterId);
    if (idx >= 0) return keyBetween(list[idx].position, list[idx + 1]?.position || null);
  }
  if (beforeId) {
    const idx = list.findIndex((b) => b.id === beforeId);
    if (idx >= 0) return keyBetween(list[idx - 1]?.position || null, list[idx].position);
  }
  return keyBetween(list[list.length - 1].position, null);
}

/**
 * Cria um bloco. Tipo desconhecido não é erro fatal: vira `unsupported`
 * guardando o payload original (§52).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createBlock(ctx, input = {}) {
  const { pageId } = input;
  if (!pageId) throw new WorkspaceError(400, "missing_pageId");
  await assertPageInWorkspace(ctx, pageId);

  const type = isBlockType(input.type) ? input.type : "unsupported";
  const rawContent =
    type === "unsupported" && !isBlockType(input.type)
      ? { originalType: input.type, originalPayload: input.content || {} }
      : input.content;

  const parentBlockId = input.parentBlockId || null;
  if (parentBlockId) {
    const parent = await getBlock(ctx, parentBlockId);
    if (!blockSpec(parent.type).children) {
      throw new WorkspaceError(400, "parent_block_cannot_nest", { type: parent.type });
    }
  }

  const { content, plainText } = normalizeBlockContent(type, rawContent);
  const position = await positionFor(ctx, {
    pageId,
    parentBlockId,
    afterId: input.afterId,
    beforeId: input.beforeId,
  });

  const { data, error } = await db()
    .from("workspace_blocks")
    .insert({
      // O editor gera o id para poder renderizar antes da resposta; se
      // vier qualquer coisa que não seja UUID, o banco é quem decide.
      ...(UUID_RE.test(input.id || "") ? { id: input.id } : {}),
      workspace_id: ctx.workspaceId,
      page_id: pageId,
      tab_id: input.tabId || null,
      parent_block_id: parentBlockId,
      type,
      content,
      props: normalizeBlockProps(input.props),
      plain_text: plainText,
      position,
      created_by: ctx.userKey,
      updated_by: ctx.userKey,
    })
    .select(BLOCK_FIELDS)
    .maybeSingle();
  if (error) fail(error, "block_create_failed");

  await recordRevision(ctx, {
    pageId,
    entityType: "block",
    entityId: data.id,
    operation: "create",
    after: { type: data.type },
  });
  return data;
}

export async function updateBlock(ctx, blockId, patch = {}) {
  const before = await getBlock(ctx, blockId);
  const type = patch.type && isBlockType(patch.type) ? patch.type : before.type;

  const row = { updated_by: ctx.userKey };
  if (type !== before.type) row.type = type;

  if (Object.prototype.hasOwnProperty.call(patch, "content") || type !== before.type) {
    // "Turn into" preserva o texto: reaproveita o content anterior quando
    // o cliente não manda um novo.
    const source = Object.prototype.hasOwnProperty.call(patch, "content")
      ? patch.content
      : before.content;
    const { content, plainText } = normalizeBlockContent(type, source);
    row.content = content;
    row.plain_text = plainText;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "props")) {
    row.props = normalizeBlockProps(patch.props);
  }

  const { data, error } = await db()
    .from("workspace_blocks")
    .update(row)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", blockId)
    .select(BLOCK_FIELDS)
    .maybeSingle();
  if (error) fail(error, "block_update_failed");

  // Só registra revisão quando muda estrutura ou tipo; digitação contínua
  // já é coberta pelo autosave e não deve inflar o histórico (§35).
  if (row.type) {
    await recordRevision(ctx, {
      pageId: before.page_id,
      entityType: "block",
      entityId: blockId,
      operation: "update",
      before: { type: before.type },
      after: { type: data.type },
    });
  }
  return data;
}

/**
 * Salva vários blocos de uma vez — é o que o autosave usa quando o
 * usuário editou uma sequência de blocos antes do debounce disparar.
 */
export async function updateBlocks(ctx, patches = []) {
  const out = [];
  for (const patch of patches.slice(0, 100)) {
    if (!patch?.id) continue;
    out.push(await updateBlock(ctx, patch.id, patch));
  }
  return out;
}

export async function moveBlock(ctx, blockId, { parentBlockId = undefined, afterId, beforeId }) {
  const block = await getBlock(ctx, blockId);
  const nextParent =
    parentBlockId === undefined ? block.parent_block_id : parentBlockId || null;

  if (nextParent) {
    if (nextParent === blockId) throw new WorkspaceError(400, "cannot_parent_to_self");
    const parent = await getBlock(ctx, nextParent);
    if (parent.page_id !== block.page_id) throw new WorkspaceError(400, "cross_page_move");
    if (!blockSpec(parent.type).children) {
      throw new WorkspaceError(400, "parent_block_cannot_nest", { type: parent.type });
    }
    if (await isDescendantBlock(ctx, block.page_id, nextParent, blockId)) {
      throw new WorkspaceError(400, "cannot_move_into_descendant");
    }
  }

  const position = await positionFor(ctx, {
    pageId: block.page_id,
    parentBlockId: nextParent,
    afterId,
    beforeId,
    excludeId: blockId,
  });

  const { data, error } = await db()
    .from("workspace_blocks")
    .update({ parent_block_id: nextParent, position, updated_by: ctx.userKey })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", blockId)
    .select(BLOCK_FIELDS)
    .maybeSingle();
  if (error) fail(error, "block_move_failed");

  await recordRevision(ctx, {
    pageId: block.page_id,
    entityType: "block",
    entityId: blockId,
    operation: "move",
    before: { parent_block_id: block.parent_block_id, position: block.position },
    after: { parent_block_id: data.parent_block_id, position: data.position },
  });
  return data;
}

async function isDescendantBlock(ctx, pageId, candidateId, rootId) {
  const all = await listBlocks(ctx, pageId);
  const byId = new Map(all.map((b) => [b.id, b]));
  let cur = byId.get(candidateId);
  const seen = new Set();
  while (cur && cur.parent_block_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parent_block_id === rootId) return true;
    cur = byId.get(cur.parent_block_id);
  }
  return false;
}

export async function duplicateBlock(ctx, blockId) {
  const source = await getBlock(ctx, blockId);
  const position = await positionFor(ctx, {
    pageId: source.page_id,
    parentBlockId: source.parent_block_id,
    afterId: source.id,
  });

  const { data, error } = await db()
    .from("workspace_blocks")
    .insert({
      workspace_id: ctx.workspaceId,
      page_id: source.page_id,
      tab_id: source.tab_id,
      parent_block_id: source.parent_block_id,
      type: source.type,
      content: source.content,
      props: source.props,
      plain_text: normalizeBlockContent(source.type, source.content).plainText,
      position,
      created_by: ctx.userKey,
      updated_by: ctx.userKey,
    })
    .select(BLOCK_FIELDS)
    .maybeSingle();
  if (error) fail(error, "block_duplicate_failed");
  return data;
}

export async function deleteBlock(ctx, blockId) {
  const block = await getBlock(ctx, blockId);
  const { error } = await db()
    .from("workspace_blocks")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", blockId);
  if (error) fail(error, "block_delete_failed");

  await recordRevision(ctx, {
    pageId: block.page_id,
    entityType: "block",
    entityId: blockId,
    operation: "delete",
    before: { type: block.type, content: block.content },
  });
  return { id: blockId };
}

async function assertPageInWorkspace(ctx, pageId) {
  const { data, error } = await db()
    .from("workspace_pages")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", pageId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new WorkspaceError(404, "page_not_found");
}

export { BLOCK_FIELDS };

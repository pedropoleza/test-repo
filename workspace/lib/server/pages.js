/**
 * Repositório de páginas.
 *
 * Toda função recebe `ctx` (de context.js) e filtra por
 * `workspace_id = ctx.workspaceId`. Nenhuma leitura por id sozinho (§63).
 */
import { db } from "./db.js";
import { keyBetween, byPosition } from "../../src/shared/fracdex.js";
import { WorkspaceError } from "./context.js";
import { recordRevision } from "./revisions.js";
import {
  normalizeBlockContent,
  normalizeBlockProps,
  isBlockType,
} from "../../src/shared/blocks.js";

const PAGE_FIELDS =
  "id,workspace_id,parent_page_id,database_id,section_id,title,icon_type,icon_value,cover_type," +
  "cover_value,cover_position_y,cover_height,layout_width,visibility,position," +
  "properties,source,source_external_id,is_archived,archived_at,created_by," +
  "updated_by,created_at,updated_at";

const TREE_FIELDS =
  "id,parent_page_id,title,icon_type,icon_value,visibility,position," +
  "is_archived,updated_at,source,database_id,section_id";

function fail(error, code = "db_error") {
  throw new WorkspaceError(500, code, { detail: error.message });
}

/* ------------------------------------------------------------------ */
/* Leitura                                                            */
/* ------------------------------------------------------------------ */

/**
 * Árvore completa do workspace (sidebar). Um request, não N.
 *
 * Registros de database são páginas também, mas ficam de fora por padrão:
 * uma tabela com 500 linhas viraria 500 itens na navegação. Breadcrumbs
 * pedem `includeRecords` para conseguir subir a partir de um registro.
 */
export async function listTree(ctx, { includeArchived = false, includeRecords = false } = {}) {
  let query = db()
    .from("workspace_pages")
    .select(TREE_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .order("position", { ascending: true });
  if (!includeArchived) query = query.eq("is_archived", false);
  if (!includeRecords) query = query.is("database_id", null);

  const { data, error } = await query;
  if (error) fail(error);
  return (data || []).sort(byPosition);
}

export async function getPage(ctx, pageId) {
  const { data, error } = await db()
    .from("workspace_pages")
    .select(PAGE_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", pageId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new WorkspaceError(404, "page_not_found");
  return data;
}

/** Cadeia de ancestrais, da raiz até a página (breadcrumbs). */
export async function getAncestors(ctx, pageId) {
  const tree = await listTree(ctx, { includeArchived: true, includeRecords: true });
  const byId = new Map(tree.map((p) => [p.id, p]));
  const chain = [];
  let current = byId.get(pageId);
  const guard = new Set();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    chain.unshift({
      id: current.id,
      title: current.title,
      icon_type: current.icon_type,
      icon_value: current.icon_value,
    });
    current = current.parent_page_id ? byId.get(current.parent_page_id) : null;
  }
  return chain;
}

/* ------------------------------------------------------------------ */
/* Posicionamento                                                     */
/* ------------------------------------------------------------------ */

async function siblingPositions(ctx, parentPageId) {
  let query = db()
    .from("workspace_pages")
    .select("id,position")
    .eq("workspace_id", ctx.workspaceId)
    .eq("is_archived", false);
  query = parentPageId
    ? query.eq("parent_page_id", parentPageId)
    : query.is("parent_page_id", null);
  const { data, error } = await query;
  if (error) fail(error);
  return (data || []).sort(byPosition);
}

/**
 * Calcula a chave de ordenação a partir dos vizinhos pedidos pelo cliente.
 * O cliente manda "depois de X" / "antes de Y" — nunca um índice absoluto.
 */
async function positionFor(ctx, { parentPageId, afterId, beforeId, excludeId }) {
  const siblings = (await siblingPositions(ctx, parentPageId)).filter(
    (s) => s.id !== excludeId,
  );
  if (!siblings.length) return keyBetween(null, null);

  if (afterId) {
    const idx = siblings.findIndex((s) => s.id === afterId);
    if (idx >= 0) {
      return keyBetween(siblings[idx].position, siblings[idx + 1]?.position || null);
    }
  }
  if (beforeId) {
    const idx = siblings.findIndex((s) => s.id === beforeId);
    if (idx >= 0) {
      return keyBetween(siblings[idx - 1]?.position || null, siblings[idx].position);
    }
  }
  return keyBetween(siblings[siblings.length - 1].position, null);
}

/* ------------------------------------------------------------------ */
/* Escrita                                                            */
/* ------------------------------------------------------------------ */

export async function createPage(ctx, input = {}) {
  const parentPageId = input.parentPageId || null;
  if (parentPageId) await getPage(ctx, parentPageId); // valida tenant do pai

  const position = await positionFor(ctx, {
    parentPageId,
    afterId: input.afterId,
    beforeId: input.beforeId,
  });

  const row = {
    workspace_id: ctx.workspaceId,
    parent_page_id: parentPageId,
    title: typeof input.title === "string" ? input.title.slice(0, 500) : "",
    icon_type: input.iconType || null,
    icon_value: input.iconValue || null,
    visibility: input.visibility === "shared" ? "shared" : "private",
    section_id: parentPageId ? null : (input.sectionId || null),
    position,
    created_by: ctx.userKey,
    updated_by: ctx.userKey,
  };

  const { data, error } = await db()
    .from("workspace_pages")
    .insert(row)
    .select(PAGE_FIELDS)
    .maybeSingle();
  if (error) fail(error, "page_create_failed");

  await recordRevision(ctx, {
    pageId: data.id,
    entityType: "page",
    entityId: data.id,
    operation: "create",
    after: { title: data.title, parent_page_id: data.parent_page_id },
  });
  return data;
}

const PAGE_PATCHABLE = {
  title: (v) => (typeof v === "string" ? v.slice(0, 500) : ""),
  icon_type: (v) => (v === "emoji" || v === "url" ? v : null),
  icon_value: (v) => (typeof v === "string" ? v.slice(0, 2048) : null),
  cover_type: (v) => (["image", "color", "gradient"].includes(v) ? v : null),
  cover_value: (v) => (typeof v === "string" ? v.slice(0, 2048) : null),
  cover_position_y: (v) => Math.min(100, Math.max(0, Number(v) || 50)),
  cover_height: (v) => Math.min(480, Math.max(120, Math.round(Number(v) || 220))),
  layout_width: (v) => (["normal", "full", "compact"].includes(v) ? v : "normal"),
  visibility: (v) => (v === "shared" ? "shared" : "private"),
  properties: (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}),
};

export async function updatePage(ctx, pageId, patch = {}) {
  const before = await getPage(ctx, pageId);

  const row = {};
  for (const [key, coerce] of Object.entries(PAGE_PATCHABLE)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) row[key] = coerce(patch[key]);
  }
  // Remover a capa vem como cover_type: null — o par precisa cair junto.
  if (row.cover_type === null) row.cover_value = null;
  if (row.icon_type === null) row.icon_value = null;
  if (!Object.keys(row).length) return before;

  row.updated_by = ctx.userKey;

  const { data, error } = await db()
    .from("workspace_pages")
    .update(row)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", pageId)
    .select(PAGE_FIELDS)
    .maybeSingle();
  if (error) fail(error, "page_update_failed");

  await recordRevision(ctx, {
    pageId,
    entityType: "page",
    entityId: pageId,
    operation: "update",
    before: pick(before, Object.keys(row)),
    after: pick(data, Object.keys(row)),
  });
  return data;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

/** Move uma página para outro pai e/ou outra posição entre irmãos. */
export async function movePage(
  ctx, pageId, { parentPageId = undefined, sectionId = undefined, afterId, beforeId },
) {
  const page = await getPage(ctx, pageId);
  const nextParent =
    parentPageId === undefined ? page.parent_page_id : parentPageId || null;

  if (nextParent) {
    if (nextParent === pageId) throw new WorkspaceError(400, "cannot_parent_to_self");
    await getPage(ctx, nextParent);
    if (await isDescendant(ctx, nextParent, pageId)) {
      throw new WorkspaceError(400, "cannot_move_into_descendant");
    }
  }

  const position = await positionFor(ctx, {
    parentPageId: nextParent,
    afterId,
    beforeId,
    excludeId: pageId,
  });

  const row = { parent_page_id: nextParent, position, updated_by: ctx.userKey };
  // Seção só faz sentido em página de raiz: subpágina segue o pai.
  if (nextParent) row.section_id = null;
  else if (sectionId !== undefined) row.section_id = sectionId || null;

  const { data, error } = await db()
    .from("workspace_pages")
    .update(row)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", pageId)
    .select(PAGE_FIELDS)
    .maybeSingle();
  if (error) fail(error, "page_move_failed");

  await recordRevision(ctx, {
    pageId,
    entityType: "page",
    entityId: pageId,
    operation: "move",
    before: { parent_page_id: page.parent_page_id, position: page.position },
    after: { parent_page_id: data.parent_page_id, position: data.position },
  });
  return data;
}

/** `candidate` está na subárvore de `rootId`? Evita ciclos no move. */
async function isDescendant(ctx, candidateId, rootId) {
  const tree = await listTree(ctx, { includeArchived: true });
  const byId = new Map(tree.map((p) => [p.id, p]));
  let cur = byId.get(candidateId);
  const seen = new Set();
  while (cur && cur.parent_page_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parent_page_id === rootId) return true;
    cur = byId.get(cur.parent_page_id);
  }
  return false;
}

export async function archivePage(ctx, pageId, archived = true) {
  await getPage(ctx, pageId);
  const ids = archived ? await subtreeIds(ctx, pageId) : [pageId];

  const { error } = await db()
    .from("workspace_pages")
    .update({
      is_archived: archived,
      archived_at: archived ? new Date().toISOString() : null,
      updated_by: ctx.userKey,
    })
    .eq("workspace_id", ctx.workspaceId)
    .in("id", ids);
  if (error) fail(error, "page_archive_failed");

  await recordRevision(ctx, {
    pageId,
    entityType: "page",
    entityId: pageId,
    operation: archived ? "delete" : "restore",
    after: { ids },
  });
  return { ids, archived };
}

/** Exclusão definitiva. Cascata de blocos/subpáginas é do Postgres. */
export async function deletePage(ctx, pageId) {
  await getPage(ctx, pageId);
  const { error } = await db()
    .from("workspace_pages")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", pageId);
  if (error) fail(error, "page_delete_failed");
  await recordRevision(ctx, {
    entityType: "page",
    entityId: pageId,
    operation: "delete",
    before: { permanent: true },
  });
  return { id: pageId };
}

async function subtreeIds(ctx, rootId) {
  const tree = await listTree(ctx, { includeArchived: true });
  const childrenOf = new Map();
  for (const p of tree) {
    const key = p.parent_page_id || "__root__";
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(p);
  }
  const out = [];
  const stack = [rootId];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of childrenOf.get(id) || []) stack.push(child.id);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Duplicação                                                         */
/* ------------------------------------------------------------------ */

/** Duplica a página e toda a sua subárvore (páginas + blocos). */
export async function duplicatePage(ctx, pageId) {
  const source = await getPage(ctx, pageId);
  const tree = await listTree(ctx, { includeArchived: false });
  const childrenOf = new Map();
  for (const p of tree) {
    const key = p.parent_page_id || "__root__";
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(p);
  }

  const position = await positionFor(ctx, {
    parentPageId: source.parent_page_id,
    afterId: source.id,
  });

  const rootCopy = await insertPageCopy(ctx, source, {
    parentPageId: source.parent_page_id,
    position,
    title: `${source.title || "Sem título"} (cópia)`,
  });

  const queue = [[source.id, rootCopy.id]];
  while (queue.length) {
    const [srcId, dstId] = queue.shift();
    await copyBlocksTo(ctx, srcId, dstId);
    for (const child of (childrenOf.get(srcId) || []).sort(byPosition)) {
      const full = await getPage(ctx, child.id);
      const copy = await insertPageCopy(ctx, full, {
        parentPageId: dstId,
        position: full.position,
        title: full.title,
      });
      queue.push([child.id, copy.id]);
    }
  }

  await recordRevision(ctx, {
    pageId: rootCopy.id,
    entityType: "page",
    entityId: rootCopy.id,
    operation: "create",
    after: { duplicated_from: pageId },
  });
  return rootCopy;
}

async function insertPageCopy(ctx, source, { parentPageId, position, title }) {
  const { data, error } = await db()
    .from("workspace_pages")
    .insert({
      workspace_id: ctx.workspaceId,
      parent_page_id: parentPageId,
      title,
      icon_type: source.icon_type,
      icon_value: source.icon_value,
      cover_type: source.cover_type,
      cover_value: source.cover_value,
      cover_position_y: source.cover_position_y,
      cover_height: source.cover_height,
      layout_width: source.layout_width,
      visibility: source.visibility,
      position,
      properties: source.properties,
      // A cópia é conteúdo local novo: não herda o vínculo externo, senão
      // o mapping de import (§47) apontaria para duas páginas.
      source: "native",
      created_by: ctx.userKey,
      updated_by: ctx.userKey,
    })
    .select(PAGE_FIELDS)
    .maybeSingle();
  if (error) fail(error, "page_duplicate_failed");
  return data;
}

/** Copia os blocos de uma página para outra preservando a hierarquia. */
async function copyBlocksTo(ctx, sourcePageId, targetPageId) {
  const { data, error } = await db()
    .from("workspace_blocks")
    .select("id,parent_block_id,type,content,props,plain_text,position")
    .eq("workspace_id", ctx.workspaceId)
    .eq("page_id", sourcePageId);
  if (error) fail(error);
  const blocks = (data || []).sort(byPosition);
  if (!blocks.length) return;

  const idMap = new Map();
  // Insere por nível para que o pai já exista quando o filho for criado.
  let level = blocks.filter((b) => !b.parent_block_id);
  const remaining = blocks.filter((b) => b.parent_block_id);
  while (level.length) {
    const rows = level.map((b) => ({
      workspace_id: ctx.workspaceId,
      page_id: targetPageId,
      parent_block_id: b.parent_block_id ? idMap.get(b.parent_block_id) : null,
      type: isBlockType(b.type) ? b.type : "unsupported",
      content: normalizeBlockContent(b.type, b.content).content,
      props: normalizeBlockProps(b.props),
      plain_text: b.plain_text || "",
      position: b.position,
      created_by: ctx.userKey,
      updated_by: ctx.userKey,
    }));
    const { data: inserted, error: insErr } = await db()
      .from("workspace_blocks")
      .insert(rows)
      .select("id");
    if (insErr) fail(insErr, "block_duplicate_failed");
    level.forEach((b, i) => idMap.set(b.id, inserted[i].id));

    const nextIds = new Set(level.map((b) => b.id));
    level = remaining.filter((b) => nextIds.has(b.parent_block_id));
    for (const b of level) {
      const idx = remaining.indexOf(b);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Favoritos e recentes                                               */
/* ------------------------------------------------------------------ */

export async function listFavorites(ctx) {
  const { data, error } = await db()
    .from("workspace_favorites")
    .select("target_type,target_id,position")
    .eq("workspace_id", ctx.workspaceId)
    .eq("user_key", ctx.userKey);
  if (error) fail(error);
  return (data || []).sort(byPosition);
}

export async function setFavorite(ctx, targetId, favorite, targetType = "page") {
  if (favorite) {
    const current = await listFavorites(ctx);
    const last = current[current.length - 1];
    const { error } = await db().from("workspace_favorites").upsert(
      {
        workspace_id: ctx.workspaceId,
        user_key: ctx.userKey,
        target_type: targetType,
        target_id: targetId,
        position: keyBetween(last ? last.position : null, null),
      },
      { onConflict: "workspace_id,user_key,target_type,target_id" },
    );
    if (error) fail(error, "favorite_failed");
  } else {
    const { error } = await db()
      .from("workspace_favorites")
      .delete()
      .eq("workspace_id", ctx.workspaceId)
      .eq("user_key", ctx.userKey)
      .eq("target_type", targetType)
      .eq("target_id", targetId);
    if (error) fail(error, "favorite_failed");
  }
  return { targetId, favorite };
}

/**
 * Registra um acesso. Recentes precisam de sinal próprio: abrir uma
 * página não é editá-la, então `updated_at` não serve (§31).
 */
export async function touchRecent(ctx, targetId, targetType = "page") {
  const { data } = await db()
    .from("workspace_recent_items")
    .select("visit_count")
    .eq("workspace_id", ctx.workspaceId)
    .eq("user_key", ctx.userKey)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();

  await db().from("workspace_recent_items").upsert(
    {
      workspace_id: ctx.workspaceId,
      user_key: ctx.userKey,
      target_type: targetType,
      target_id: targetId,
      last_visited_at: new Date().toISOString(),
      visit_count: (data?.visit_count || 0) + 1,
    },
    { onConflict: "workspace_id,user_key,target_type,target_id" },
  );
}

export async function listRecent(ctx, limit = 12) {
  const { data, error } = await db()
    .from("workspace_recent_items")
    .select("target_type,target_id,last_visited_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("user_key", ctx.userKey)
    .order("last_visited_at", { ascending: false })
    .limit(Math.min(limit, 50));
  if (error) fail(error);
  return data || [];
}

export { PAGE_FIELDS };

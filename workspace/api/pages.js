/**
 * /api/workspace/pages — CRUD e organização de páginas.
 *
 *   GET    ?id=<uuid>            → página + blocos + breadcrumbs
 *   GET    ?action=tree          → árvore da sidebar
 *   GET    ?action=trash         → páginas arquivadas
 *   POST                         → cria página          { parentPageId, title, afterId }
 *   POST   ?action=duplicate     → duplica subárvore     { id }
 *   POST   ?action=move          → move/reordena         { id, parentPageId, afterId, beforeId }
 *   POST   ?action=archive       → manda para o lixo     { id }
 *   POST   ?action=restore       → tira do lixo          { id }
 *   POST   ?action=favorite      → (des)favorita         { id, favorite }
 *   POST   ?action=visit         → registra em recentes  { id }
 *   PATCH  ?id=<uuid>            → título, ícone, capa, largura, visibilidade
 *   DELETE ?id=<uuid>            → exclusão definitiva
 *
 * Escrita exige papel >= editor; leitura, >= viewer (§62).
 */
import {
  resolveContext,
  requireRole,
  sendError,
  WorkspaceError,
} from "../lib/server/context.js";
import {
  listTree,
  getPage,
  getAncestors,
  createPage,
  updatePage,
  movePage,
  archivePage,
  deletePage,
  duplicatePage,
  setFavorite,
  touchRecent,
} from "../lib/server/pages.js";
import { listBlocks } from "../lib/server/blocks.js";
import { log } from "../lib/server/log.js";

export default async function handler(req, res) {
  let ctx;
  try {
    ctx = await resolveContext(req);
  } catch (err) {
    return sendError(res, err);
  }

  try {
    const body = parseBody(req);
    const action = req.query?.action || body.action || null;

    switch (req.method) {
      case "GET":
        return res.status(200).json(await handleGet(ctx, req));
      case "POST":
        requireRole(ctx, "editor");
        return res.status(action ? 200 : 201).json(await handlePost(ctx, action, body));
      case "PATCH": {
        requireRole(ctx, "editor");
        const id = req.query?.id || body.id;
        if (!id) throw new WorkspaceError(400, "missing_id");
        const page = await updatePage(ctx, id, body);
        log.info("workspace.page.updated", { workspaceId: ctx.workspaceId, pageId: id });
        return res.status(200).json({ page });
      }
      case "DELETE": {
        requireRole(ctx, "admin");
        const id = req.query?.id || body.id;
        if (!id) throw new WorkspaceError(400, "missing_id");
        return res.status(200).json(await deletePage(ctx, id));
      }
      default:
        res.setHeader("Allow", "GET, POST, PATCH, DELETE");
        return res.status(405).json({ error: "method_not_allowed" });
    }
  } catch (err) {
    return sendError(res, err);
  }
}

async function handleGet(ctx, req) {
  const action = req.query?.action;

  if (action === "tree") {
    return { pages: await listTree(ctx) };
  }
  if (action === "trash") {
    const all = await listTree(ctx, { includeArchived: true });
    return { pages: all.filter((p) => p.is_archived) };
  }

  const id = req.query?.id;
  if (!id) throw new WorkspaceError(400, "missing_id");

  const [page, blocks, breadcrumbs] = await Promise.all([
    getPage(ctx, id),
    listBlocks(ctx, id),
    getAncestors(ctx, id),
  ]);
  return { page, blocks, breadcrumbs };
}

async function handlePost(ctx, action, body) {
  switch (action) {
    case null:
    case undefined:
    case "create": {
      const page = await createPage(ctx, body);
      log.info("workspace.page.created", {
        workspaceId: ctx.workspaceId,
        pageId: page.id,
        hasParent: !!page.parent_page_id,
      });
      return { page };
    }
    case "duplicate":
      return { page: await duplicatePage(ctx, requireId(body)) };
    case "move":
      return { page: await movePage(ctx, requireId(body), body) };
    case "archive":
      return await archivePage(ctx, requireId(body), true);
    case "restore":
      return await archivePage(ctx, requireId(body), false);
    case "favorite":
      return await setFavorite(ctx, requireId(body), body.favorite !== false);
    case "visit":
      await touchRecent(ctx, requireId(body));
      return { ok: true };
    default:
      throw new WorkspaceError(400, "unknown_action", { action });
  }
}

function requireId(body) {
  if (!body?.id) throw new WorkspaceError(400, "missing_id");
  return body.id;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

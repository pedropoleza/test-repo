/**
 * /api/workspace/blocks — conteúdo block-based.
 *
 *   GET    ?pageId=<uuid>       → blocos da página (ordenados)
 *   POST                        → cria bloco   { pageId, type, content, afterId, parentBlockId }
 *   POST   ?action=move         → move/reordena/aninha { id, parentBlockId, afterId, beforeId }
 *   POST   ?action=duplicate    → duplica      { id }
 *   PATCH                       → salva 1 bloco  { id, content, props, type }
 *   PATCH  ?action=bulk         → salva N blocos { blocks: [...] }  ← autosave
 *   DELETE ?id=<uuid>           → remove
 *
 * O autosave do editor usa PATCH ?action=bulk com debounce, então esta
 * rota é a mais quente do módulo: nada de trabalho extra por request.
 */
import {
  resolveContext,
  requireRole,
  sendError,
  WorkspaceError,
} from "../lib/server/context.js";
import {
  listBlocks,
  createBlock,
  updateBlock,
  updateBlocks,
  moveBlock,
  duplicateBlock,
  deleteBlock,
} from "../lib/server/blocks.js";

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
      case "GET": {
        const pageId = req.query?.pageId;
        if (!pageId) throw new WorkspaceError(400, "missing_pageId");
        return res.status(200).json({ blocks: await listBlocks(ctx, pageId) });
      }
      case "POST": {
        requireRole(ctx, "editor");
        if (action === "move") {
          return res.status(200).json({ block: await moveBlock(ctx, requireId(body), body) });
        }
        if (action === "duplicate") {
          return res.status(201).json({ block: await duplicateBlock(ctx, requireId(body)) });
        }
        return res.status(201).json({ block: await createBlock(ctx, body) });
      }
      case "PATCH": {
        requireRole(ctx, "editor");
        if (action === "bulk") {
          if (!Array.isArray(body.blocks)) throw new WorkspaceError(400, "missing_blocks");
          return res.status(200).json({ blocks: await updateBlocks(ctx, body.blocks) });
        }
        const id = req.query?.id || body.id;
        if (!id) throw new WorkspaceError(400, "missing_id");
        return res.status(200).json({ block: await updateBlock(ctx, id, body) });
      }
      case "DELETE": {
        requireRole(ctx, "editor");
        const id = req.query?.id || body.id;
        if (!id) throw new WorkspaceError(400, "missing_id");
        return res.status(200).json(await deleteBlock(ctx, id));
      }
      default:
        res.setHeader("Allow", "GET, POST, PATCH, DELETE");
        return res.status(405).json({ error: "method_not_allowed" });
    }
  } catch (err) {
    return sendError(res, err);
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

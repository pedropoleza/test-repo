/**
 * /api/databases — database engine (§16–22).
 *
 *   GET    ?id=&viewId=            → database + campos + views + registros
 *   POST                           → cria database (campos padrão + view)
 *   PATCH  ?id=                    → título, ícone, descrição
 *   DELETE ?id=
 *
 *   POST   ?action=field&id=       → cria campo
 *   PATCH  ?action=field&fieldId=  → renomeia / troca tipo / opções
 *   POST   ?action=field_move      → reordena campo
 *   DELETE ?action=field&fieldId=  → remove campo (valores ficam guardados)
 *
 *   POST   ?action=view&id=        → cria view
 *   PATCH  ?action=view&viewId=    → filtros, sorts, agrupamento, colunas
 *   DELETE ?action=view&viewId=
 *
 *   POST   ?action=record&id=      → cria registro (= página)
 *   PATCH  ?action=record&recordId=→ título e propriedades
 *   POST   ?action=record_move     → reordena registro
 *   DELETE ?action=record&recordId=
 */
import {
  resolveContext, requireRole, sendError, WorkspaceError,
} from "../lib/server/context.js";
import {
  getDatabaseBundle, createDatabase, updateDatabase, deleteDatabase,
  createField, updateField, moveField, deleteField,
  createView, updateView, deleteView,
  createRecord, updateRecord, moveRecord, deleteRecord,
} from "../lib/server/databases.js";

export default async function handler(req, res) {
  let ctx;
  try {
    ctx = await resolveContext(req);
  } catch (err) {
    return sendError(res, err);
  }

  try {
    const body = parseBody(req);
    const q = req.query || {};
    const action = q.action || body.action || null;
    const id = q.id || body.id;

    switch (req.method) {
      case "GET": {
        if (!id) throw new WorkspaceError(400, "missing_id");
        return res.status(200).json(await getDatabaseBundle(ctx, id, { viewId: q.viewId }));
      }

      case "POST": {
        requireRole(ctx, "editor");
        switch (action) {
          case "field":
            return res.status(201).json({ field: await createField(ctx, need(id), body) });
          case "field_move":
            return res.status(200).json({
              field: await moveField(ctx, need(q.fieldId || body.fieldId, "missing_fieldId"), body),
            });
          case "view":
            return res.status(201).json({ view: await createView(ctx, need(id), body) });
          case "record":
            return res.status(201).json({ record: await createRecord(ctx, need(id), body) });
          case "record_move":
            return res.status(200).json({
              record: await moveRecord(ctx, need(q.recordId || body.recordId, "missing_recordId"), body),
            });
          default:
            return res.status(201).json({ database: await createDatabase(ctx, body) });
        }
      }

      case "PATCH": {
        requireRole(ctx, "editor");
        switch (action) {
          case "field":
            return res.status(200).json({
              field: await updateField(ctx, need(q.fieldId || body.fieldId, "missing_fieldId"), body),
            });
          case "view":
            return res.status(200).json({
              view: await updateView(ctx, need(q.viewId || body.viewId, "missing_viewId"), body),
            });
          case "record":
            return res.status(200).json({
              record: await updateRecord(ctx, need(q.recordId || body.recordId, "missing_recordId"), body),
            });
          default:
            return res.status(200).json({ database: await updateDatabase(ctx, need(id), body) });
        }
      }

      case "DELETE": {
        requireRole(ctx, "editor");
        switch (action) {
          case "field":
            return res.status(200).json(await deleteField(ctx, need(q.fieldId, "missing_fieldId")));
          case "view":
            return res.status(200).json(await deleteView(ctx, need(q.viewId, "missing_viewId")));
          case "record":
            return res.status(200).json(await deleteRecord(ctx, need(q.recordId, "missing_recordId")));
          default:
            return res.status(200).json(await deleteDatabase(ctx, need(id)));
        }
      }

      default:
        res.setHeader("Allow", "GET, POST, PATCH, DELETE");
        return res.status(405).json({ error: "method_not_allowed" });
    }
  } catch (err) {
    return sendError(res, err);
  }
}

function need(value, code = "missing_id") {
  if (!value) throw new WorkspaceError(400, code);
  return value;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

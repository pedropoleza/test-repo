/**
 * Repositório de databases: database, campos, views e registros.
 *
 * Registros são páginas com `database_id`, então tudo que já existe para
 * página (blocos, ícone, capa, histórico) vale para um registro sem código
 * novo. Este módulo cuida só do que é específico de database.
 */
import { db } from "./db.js";
import { keyBetween, byPosition } from "../../src/shared/fracdex.js";
import { WorkspaceError } from "./context.js";
import { recordRevision } from "./revisions.js";
import {
  isFieldType, fieldKeyFrom, normalizeValue, normalizeFilter, normalizeSorts,
  matchesFilter, applySorts, isViewType, OPTION_COLORS,
} from "../../src/shared/fields.js";

const DB_FIELDS =
  "id,workspace_id,page_id,title,icon_type,icon_value,description,source," +
  "source_external_id,created_at,updated_at";
const FIELD_FIELDS =
  "id,database_id,key,name,type,config,is_primary,position,created_at,updated_at";
const VIEW_FIELDS =
  "id,database_id,name,type,filters,sorts,group_by,visible_fields,field_order," +
  "layout,position,created_at,updated_at";
const RECORD_FIELDS =
  "id,database_id,parent_page_id,title,icon_type,icon_value,properties," +
  "position,created_by,updated_by,created_at,updated_at";

/** Teto de registros lidos por vez. Ver nota de escala no runbook. */
export const RECORD_FETCH_CAP = 2000;

function fail(error, code = "db_error") {
  throw new WorkspaceError(500, code, { detail: error.message });
}

/* ------------------------------------------------------------------ */
/* Leitura                                                            */
/* ------------------------------------------------------------------ */

export async function getDatabase(ctx, databaseId) {
  const { data, error } = await db()
    .from("workspace_databases")
    .select(DB_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", databaseId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new WorkspaceError(404, "database_not_found");
  return data;
}

export async function listFields(ctx, databaseId) {
  const { data, error } = await db()
    .from("workspace_database_fields")
    .select(FIELD_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("database_id", databaseId);
  if (error) fail(error);
  return (data || []).sort(byPosition);
}

export async function listViews(ctx, databaseId) {
  const { data, error } = await db()
    .from("workspace_database_views")
    .select(VIEW_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("database_id", databaseId);
  if (error) fail(error);
  return (data || []).sort(byPosition);
}

export async function listRecords(ctx, databaseId) {
  const { data, error } = await db()
    .from("workspace_pages")
    .select(RECORD_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("database_id", databaseId)
    .eq("is_archived", false)
    .limit(RECORD_FETCH_CAP);
  if (error) fail(error);
  return (data || []).sort(byPosition);
}

/**
 * Database completa, com os registros já filtrados e ordenados pela view.
 *
 * Filtro e ordenação rodam aqui, em JS, sobre no máximo RECORD_FETCH_CAP
 * registros. É suficiente para o volume desta fase e mantém o motor de
 * filtro idêntico ao do cliente; quando uma database passar do teto, o
 * caminho é traduzir o JSON de filtro para SQL — a forma do filtro já foi
 * desenhada para isso.
 */
export async function getDatabaseBundle(ctx, databaseId, { viewId } = {}) {
  const [database, fields, views] = await Promise.all([
    getDatabase(ctx, databaseId),
    listFields(ctx, databaseId),
    listViews(ctx, databaseId),
  ]);

  const view = views.find((v) => v.id === viewId) || views[0] || null;
  const all = await listRecords(ctx, databaseId);

  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  let records = all;
  if (view) {
    records = all.filter((r) => matchesFilter(view.filters, r, byKey));
    records = applySorts(records, view.sorts, byKey);
  }

  return {
    database,
    fields,
    views,
    viewId: view?.id || null,
    records,
    totalRecords: all.length,
    truncated: all.length >= RECORD_FETCH_CAP,
  };
}

/* ------------------------------------------------------------------ */
/* Criação                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_FIELDS = [
  { name: "Nome",   type: "text",     is_primary: true },
  { name: "Status", type: "status",   config: { options: [
      { id: "todo",  name: "A fazer",     color: "gray" },
      { id: "doing", name: "Em andamento", color: "blue" },
      { id: "done",  name: "Concluído",   color: "green" },
  ] } },
  { name: "Responsável", type: "person" },
  { name: "Prazo",       type: "date" },
];

/** Cria a database já utilizável: campos padrão + uma view de tabela. */
export async function createDatabase(ctx, input = {}) {
  const pageId = input.pageId || null;
  if (pageId) await assertPage(ctx, pageId);

  const { data: database, error } = await db()
    .from("workspace_databases")
    .insert({
      workspace_id: ctx.workspaceId,
      page_id: pageId,
      title: typeof input.title === "string" && input.title.trim()
        ? input.title.slice(0, 300) : "Nova tabela",
      created_by: ctx.userKey,
      updated_by: ctx.userKey,
    })
    .select(DB_FIELDS)
    .maybeSingle();
  if (error) fail(error, "database_create_failed");

  let position = null;
  const taken = [];
  for (const spec of DEFAULT_FIELDS) {
    position = keyBetween(position, null);
    const key = fieldKeyFrom(spec.name, taken);
    taken.push(key);
    const { error: fErr } = await db().from("workspace_database_fields").insert({
      workspace_id: ctx.workspaceId,
      database_id: database.id,
      key,
      name: spec.name,
      type: spec.type,
      config: spec.config || {},
      is_primary: !!spec.is_primary,
      position,
    });
    if (fErr) fail(fErr, "field_create_failed");
  }

  const { error: vErr } = await db().from("workspace_database_views").insert({
    workspace_id: ctx.workspaceId,
    database_id: database.id,
    name: "Tabela",
    type: "table",
    position: keyBetween(null, null),
  });
  if (vErr) fail(vErr, "view_create_failed");

  await recordRevision(ctx, {
    pageId, entityType: "database", entityId: database.id,
    operation: "create", after: { title: database.title },
  });
  return database;
}

export async function updateDatabase(ctx, databaseId, patch = {}) {
  await getDatabase(ctx, databaseId);
  const row = { updated_by: ctx.userKey };
  if (typeof patch.title === "string") row.title = patch.title.slice(0, 300);
  if (typeof patch.description === "string") row.description = patch.description.slice(0, 2000);
  if (patch.icon_type === null || patch.icon_type === "emoji" || patch.icon_type === "url") {
    row.icon_type = patch.icon_type;
    row.icon_value = patch.icon_type ? String(patch.icon_value || "").slice(0, 2048) : null;
  }

  const { data, error } = await db()
    .from("workspace_databases")
    .update(row)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", databaseId)
    .select(DB_FIELDS)
    .maybeSingle();
  if (error) fail(error, "database_update_failed");
  return data;
}

export async function deleteDatabase(ctx, databaseId) {
  await getDatabase(ctx, databaseId);
  const { error } = await db()
    .from("workspace_databases")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", databaseId);
  if (error) fail(error, "database_delete_failed");
  await recordRevision(ctx, {
    entityType: "database", entityId: databaseId, operation: "delete",
  });
  return { id: databaseId };
}

/* ------------------------------------------------------------------ */
/* Campos                                                             */
/* ------------------------------------------------------------------ */

export async function createField(ctx, databaseId, input = {}) {
  await getDatabase(ctx, databaseId);
  const existing = await listFields(ctx, databaseId);
  const type = isFieldType(input.type) ? input.type : "text";
  const name = String(input.name || "Campo").slice(0, 120);
  const key = fieldKeyFrom(name, existing.map((f) => f.key));
  const last = existing[existing.length - 1];

  const { data, error } = await db()
    .from("workspace_database_fields")
    .insert({
      workspace_id: ctx.workspaceId,
      database_id: databaseId,
      key, name, type,
      config: normalizeFieldConfig(type, input.config),
      is_primary: false,
      position: keyBetween(last ? last.position : null, null),
    })
    .select(FIELD_FIELDS)
    .maybeSingle();
  if (error) fail(error, "field_create_failed");
  return data;
}

export async function updateField(ctx, fieldId, patch = {}) {
  const field = await getField(ctx, fieldId);
  const row = {};
  if (typeof patch.name === "string") row.name = patch.name.slice(0, 120);
  if (patch.type && isFieldType(patch.type)) row.type = patch.type;
  if (patch.config !== undefined) {
    row.config = normalizeFieldConfig(row.type || field.type, patch.config);
  }
  if (!Object.keys(row).length) return field;

  const { data, error } = await db()
    .from("workspace_database_fields")
    .update(row)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", fieldId)
    .select(FIELD_FIELDS)
    .maybeSingle();
  if (error) fail(error, "field_update_failed");
  return data;
}

export async function moveField(ctx, fieldId, { afterId, beforeId }) {
  const field = await getField(ctx, fieldId);
  const siblings = (await listFields(ctx, field.database_id)).filter((f) => f.id !== fieldId);

  let position;
  if (!siblings.length) position = keyBetween(null, null);
  else if (afterId) {
    const i = siblings.findIndex((f) => f.id === afterId);
    position = i >= 0
      ? keyBetween(siblings[i].position, siblings[i + 1]?.position || null)
      : keyBetween(siblings[siblings.length - 1].position, null);
  } else if (beforeId) {
    const i = siblings.findIndex((f) => f.id === beforeId);
    position = i >= 0
      ? keyBetween(siblings[i - 1]?.position || null, siblings[i].position)
      : keyBetween(null, siblings[0].position);
  } else position = keyBetween(siblings[siblings.length - 1].position, null);

  const { data, error } = await db()
    .from("workspace_database_fields")
    .update({ position })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", fieldId)
    .select(FIELD_FIELDS)
    .maybeSingle();
  if (error) fail(error, "field_move_failed");
  return data;
}

export async function deleteField(ctx, fieldId) {
  const field = await getField(ctx, fieldId);
  if (field.is_primary) throw new WorkspaceError(400, "cannot_delete_primary_field");

  const { error } = await db()
    .from("workspace_database_fields")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", fieldId);
  if (error) fail(error, "field_delete_failed");
  // Os valores continuam em properties. Recriar um campo com a mesma key
  // recupera os dados — apagar coluna não deve destruir conteúdo.
  return { id: fieldId, key: field.key };
}

async function getField(ctx, fieldId) {
  const { data, error } = await db()
    .from("workspace_database_fields")
    .select(FIELD_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", fieldId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new WorkspaceError(404, "field_not_found");
  return data;
}

function normalizeFieldConfig(type, config) {
  const out = {};
  const raw = config && typeof config === "object" ? config : {};

  if (["select", "multi_select", "status"].includes(type)) {
    const seen = new Set();
    out.options = (Array.isArray(raw.options) ? raw.options : [])
      .slice(0, 100)
      .map((o, i) => {
        const id = String(o?.id || `opt_${i}`).slice(0, 60);
        if (seen.has(id)) return null;
        seen.add(id);
        return {
          id,
          name: String(o?.name || "Opção").slice(0, 120),
          color: OPTION_COLORS.includes(o?.color) ? o.color : "gray",
        };
      })
      .filter(Boolean);
  }
  if (type === "number") {
    out.format = ["plain", "currency", "percent"].includes(raw.format) ? raw.format : "plain";
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Views                                                              */
/* ------------------------------------------------------------------ */

export async function createView(ctx, databaseId, input = {}) {
  await getDatabase(ctx, databaseId);
  const views = await listViews(ctx, databaseId);
  const type = isViewType(input.type) ? input.type : "table";
  const last = views[views.length - 1];

  const { data, error } = await db()
    .from("workspace_database_views")
    .insert({
      workspace_id: ctx.workspaceId,
      database_id: databaseId,
      name: String(input.name || defaultViewName(type)).slice(0, 120),
      type,
      group_by: typeof input.groupBy === "string" ? input.groupBy : null,
      position: keyBetween(last ? last.position : null, null),
    })
    .select(VIEW_FIELDS)
    .maybeSingle();
  if (error) fail(error, "view_create_failed");
  return data;
}

function defaultViewName(type) {
  return { table: "Tabela", board: "Quadro", list: "Lista", gallery: "Galeria" }[type] || "Vista";
}

export async function updateView(ctx, viewId, patch = {}) {
  const view = await getView(ctx, viewId);
  const row = {};
  if (typeof patch.name === "string") row.name = patch.name.slice(0, 120);
  if (patch.type && isViewType(patch.type)) row.type = patch.type;
  if (patch.filters !== undefined) row.filters = normalizeFilter(patch.filters);
  if (patch.sorts !== undefined) row.sorts = normalizeSorts(patch.sorts);
  if (patch.groupBy !== undefined) {
    row.group_by = typeof patch.groupBy === "string" && patch.groupBy ? patch.groupBy : null;
  }
  if (patch.visibleFields !== undefined) {
    row.visible_fields = Array.isArray(patch.visibleFields)
      ? patch.visibleFields.map(String).slice(0, 100)
      : null;
  }
  if (Array.isArray(patch.fieldOrder)) row.field_order = patch.fieldOrder.map(String).slice(0, 100);
  if (patch.layout && typeof patch.layout === "object") row.layout = patch.layout;
  if (!Object.keys(row).length) return view;

  const { data, error } = await db()
    .from("workspace_database_views")
    .update(row)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", viewId)
    .select(VIEW_FIELDS)
    .maybeSingle();
  if (error) fail(error, "view_update_failed");
  return data;
}

export async function deleteView(ctx, viewId) {
  const view = await getView(ctx, viewId);
  const views = await listViews(ctx, view.database_id);
  if (views.length <= 1) throw new WorkspaceError(400, "cannot_delete_last_view");

  const { error } = await db()
    .from("workspace_database_views")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", viewId);
  if (error) fail(error, "view_delete_failed");
  return { id: viewId };
}

async function getView(ctx, viewId) {
  const { data, error } = await db()
    .from("workspace_database_views")
    .select(VIEW_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", viewId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new WorkspaceError(404, "view_not_found");
  return data;
}

/* ------------------------------------------------------------------ */
/* Registros                                                          */
/* ------------------------------------------------------------------ */

export async function createRecord(ctx, databaseId, input = {}) {
  const database = await getDatabase(ctx, databaseId);
  const fields = await listFields(ctx, databaseId);
  const records = await listRecords(ctx, databaseId);
  const last = records[records.length - 1];

  const split = splitProperties(fields, input.properties);
  const { data, error } = await db()
    .from("workspace_pages")
    .insert({
      workspace_id: ctx.workspaceId,
      database_id: databaseId,
      // O registro pendura na mesma página que hospeda a database: assim
      // os breadcrumbs de um registro aberto em página cheia fazem sentido.
      parent_page_id: database.page_id,
      title: (split.title ?? String(input.title || "")).slice(0, 500),
      properties: split.properties,
      position: keyBetween(last ? last.position : null, null),
      created_by: ctx.userKey,
      updated_by: ctx.userKey,
    })
    .select(RECORD_FIELDS)
    .maybeSingle();
  if (error) fail(error, "record_create_failed");

  await recordRevision(ctx, {
    pageId: data.id, entityType: "record", entityId: data.id, operation: "create",
  });
  return data;
}

export async function updateRecord(ctx, recordId, patch = {}) {
  const record = await getRecord(ctx, recordId);
  const fields = await listFields(ctx, record.database_id);

  const row = { updated_by: ctx.userKey };
  if (typeof patch.title === "string") row.title = patch.title.slice(0, 500);
  if (patch.properties && typeof patch.properties === "object") {
    const split = splitProperties(fields, patch.properties);
    if (split.title !== undefined) row.title = split.title;
    // Merge, não substituição: o cliente manda só a célula que mudou.
    row.properties = { ...(record.properties || {}), ...split.properties };
  }

  const { data, error } = await db()
    .from("workspace_pages")
    .update(row)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", recordId)
    .select(RECORD_FIELDS)
    .maybeSingle();
  if (error) fail(error, "record_update_failed");
  return data;
}

export async function moveRecord(ctx, recordId, { afterId, beforeId }) {
  const record = await getRecord(ctx, recordId);
  const siblings = (await listRecords(ctx, record.database_id)).filter((r) => r.id !== recordId);

  let position;
  if (!siblings.length) position = keyBetween(null, null);
  else if (afterId) {
    const i = siblings.findIndex((r) => r.id === afterId);
    position = i >= 0
      ? keyBetween(siblings[i].position, siblings[i + 1]?.position || null)
      : keyBetween(siblings[siblings.length - 1].position, null);
  } else if (beforeId) {
    const i = siblings.findIndex((r) => r.id === beforeId);
    position = i >= 0
      ? keyBetween(siblings[i - 1]?.position || null, siblings[i].position)
      : keyBetween(null, siblings[0].position);
  } else position = keyBetween(siblings[siblings.length - 1].position, null);

  const { data, error } = await db()
    .from("workspace_pages")
    .update({ position })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", recordId)
    .select(RECORD_FIELDS)
    .maybeSingle();
  if (error) fail(error, "record_move_failed");
  return data;
}

export async function deleteRecord(ctx, recordId) {
  await getRecord(ctx, recordId);
  const { error } = await db()
    .from("workspace_pages")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", recordId);
  if (error) fail(error, "record_delete_failed");
  return { id: recordId };
}

async function getRecord(ctx, recordId) {
  const { data, error } = await db()
    .from("workspace_pages")
    .select(RECORD_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", recordId)
    .maybeSingle();
  if (error) fail(error);
  if (!data || !data.database_id) throw new WorkspaceError(404, "record_not_found");
  return data;
}

/**
 * Separa o que vai para `properties` do que vai para a coluna `title`.
 *
 * A coluna principal é o título da página (§18): escrever nela precisa
 * mudar o título, senão o registro aberto como página fica sem nome e a
 * tabela mostra um valor que a página não conhece.
 */
function splitProperties(fields, raw) {
  const properties = {};
  let title;
  if (!raw || typeof raw !== "object") return { properties, title };

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(raw, field.key)) continue;
    if (["created_time", "last_edited_time"].includes(field.type)) continue;
    if (field.is_primary) {
      title = String(raw[field.key] ?? "").slice(0, 500);
      continue;
    }
    properties[field.key] = normalizeValue(field, raw[field.key]);
  }
  return { properties, title };
}

async function assertPage(ctx, pageId) {
  const { data, error } = await db()
    .from("workspace_pages")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", pageId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new WorkspaceError(404, "page_not_found");
}

/**
 * Cliente HTTP do Workspace. Um lugar só para autenticação, envelope de
 * erro e serialização — nenhum fetch solto espalhado pelos componentes.
 */
import { authHeaders, authQuery } from "./session.js";

export class ApiError extends Error {
  constructor(status, code, payload) {
    super(code || `http_${status}`);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function buildUrl(path, query = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries({ ...authQuery(), ...query })) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function request(method, path, { query, body, keepalive = false } = {}) {
  const res = await fetch(buildUrl(path, query), {
    method,
    headers: {
      ...authHeaders(),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    // `keepalive` mantém o request vivo depois de a aba fechar/navegar —
    // é o que impede o último autosave de morrer no unload.
    keepalive,
  });

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 300) };
  }

  if (!res.ok) throw new ApiError(res.status, payload?.error, payload);
  return payload;
}

export const api = {
  bootstrap: () => request("GET", "/api/bootstrap"),

  pages: {
    tree: () => request("GET", "/api/pages", { query: { action: "tree" } }),
    trash: () => request("GET", "/api/pages", { query: { action: "trash" } }),
    get: (id) => request("GET", "/api/pages", { query: { id } }),
    create: (input) => request("POST", "/api/pages", { body: input }),
    update: (id, patch, opts = {}) =>
      request("PATCH", "/api/pages", { query: { id }, body: patch, ...opts }),
    move: (input) =>
      request("POST", "/api/pages", { query: { action: "move" }, body: input }),
    duplicate: (id) =>
      request("POST", "/api/pages", { query: { action: "duplicate" }, body: { id } }),
    archive: (id) =>
      request("POST", "/api/pages", { query: { action: "archive" }, body: { id } }),
    restore: (id) =>
      request("POST", "/api/pages", { query: { action: "restore" }, body: { id } }),
    remove: (id) => request("DELETE", "/api/pages", { query: { id } }),
    favorite: (id, favorite) =>
      request("POST", "/api/pages", {
        query: { action: "favorite" },
        body: { id, favorite },
      }),
    visit: (id) =>
      request("POST", "/api/pages", { query: { action: "visit" }, body: { id } }),
  },

  sections: {
    list: () => request("GET", "/api/pages", { query: { action: "sections" } }),
    create: (input) =>
      request("POST", "/api/pages", { query: { action: "section_create" }, body: input }),
    update: (id, patch) =>
      request("POST", "/api/pages", { query: { action: "section_update" }, body: { id, ...patch } }),
    move: (id, target) =>
      request("POST", "/api/pages", { query: { action: "section_move" }, body: { id, ...target } }),
    remove: (id) =>
      request("POST", "/api/pages", { query: { action: "section_delete" }, body: { id } }),
  },

  blocks: {
    list: (pageId) => request("GET", "/api/blocks", { query: { pageId } }),
    create: (input) => request("POST", "/api/blocks", { body: input }),
    update: (id, patch) =>
      request("PATCH", "/api/blocks", { query: { id }, body: patch }),
    bulkUpdate: (blocks, opts = {}) =>
      request("PATCH", "/api/blocks", {
        query: { action: "bulk" },
        body: { blocks },
        ...opts,
      }),
    move: (input) =>
      request("POST", "/api/blocks", { query: { action: "move" }, body: input }),
    duplicate: (id) =>
      request("POST", "/api/blocks", {
        query: { action: "duplicate" },
        body: { id },
      }),
    remove: (id) => request("DELETE", "/api/blocks", { query: { id } }),
  },

  files: {
    upload: (file) => request("POST", "/api/files", { body: file }),
  },

  crm: {
    status: () => request("GET", "/api/crm", { query: { action: "status" } }),
    contacts: (limit) => request("GET", "/api/crm", { query: { action: "contacts", limit } }),
    opportunities: (limit) =>
      request("GET", "/api/crm", { query: { action: "opportunities", limit } }),
    contact: (id) => request("GET", "/api/crm", { query: { action: "contact", id } }),
    dossiers: () => request("GET", "/api/crm", { query: { action: "dossiers" } }),
    contactOpportunities: (id) =>
      request("GET", "/api/crm", { query: { action: "contact-opportunities", id } }),
    moveStage: (opportunityId, pipelineId, stageId) =>
      request("POST", "/api/crm", {
        query: { action: "move-stage" },
        body: { opportunityId, pipelineId, stageId },
      }),
    updateOpportunity: (opportunityId, changes) =>
      request("POST", "/api/crm", {
        query: { action: "update-opportunity" },
        body: { opportunityId, changes },
      }),
    updateContact: (contactId, changes) =>
      request("POST", "/api/crm", {
        query: { action: "update-contact" },
        body: { contactId, changes },
      }),
    lists: () => request("GET", "/api/crm", { query: { action: "lists" } }),
    createList: (input) =>
      request("POST", "/api/crm", { query: { action: "list-create" }, body: input }),
    updateList: (id, patch) =>
      request("POST", "/api/crm", { query: { action: "list-update" }, body: { id, ...patch } }),
    deleteList: (id) =>
      request("POST", "/api/crm", { query: { action: "list-delete" }, body: { id } }),
    openDossier: (contactId) =>
      request("POST", "/api/crm", { query: { action: "dossier" }, body: { contactId } }),
  },

  tasks: {
    list: (limit) => request("GET", "/api/tasks", { query: { limit } }),
  },

  databases: {
    get: (id, viewId) => request("GET", "/api/databases", { query: { id, viewId } }),
    create: (input) => request("POST", "/api/databases", { body: input }),
    update: (id, patch) => request("PATCH", "/api/databases", { query: { id }, body: patch }),
    remove: (id) => request("DELETE", "/api/databases", { query: { id } }),

    createField: (id, input) =>
      request("POST", "/api/databases", { query: { action: "field", id }, body: input }),
    updateField: (fieldId, patch) =>
      request("PATCH", "/api/databases", { query: { action: "field", fieldId }, body: patch }),
    moveField: (fieldId, target) =>
      request("POST", "/api/databases", { query: { action: "field_move", fieldId }, body: target }),
    removeField: (fieldId) =>
      request("DELETE", "/api/databases", { query: { action: "field", fieldId } }),

    createView: (id, input) =>
      request("POST", "/api/databases", { query: { action: "view", id }, body: input }),
    updateView: (viewId, patch) =>
      request("PATCH", "/api/databases", { query: { action: "view", viewId }, body: patch }),
    removeView: (viewId) =>
      request("DELETE", "/api/databases", { query: { action: "view", viewId } }),

    createRecord: (id, input) =>
      request("POST", "/api/databases", { query: { action: "record", id }, body: input }),
    updateRecord: (recordId, patch) =>
      request("PATCH", "/api/databases", { query: { action: "record", recordId }, body: patch }),
    moveRecord: (recordId, target) =>
      request("POST", "/api/databases", { query: { action: "record_move", recordId }, body: target }),
    removeRecord: (recordId) =>
      request("DELETE", "/api/databases", { query: { action: "record", recordId } }),
  },
};

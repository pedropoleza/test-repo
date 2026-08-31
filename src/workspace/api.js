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
  bootstrap: () => request("GET", "/api/workspace/bootstrap"),

  pages: {
    tree: () => request("GET", "/api/workspace/pages", { query: { action: "tree" } }),
    trash: () => request("GET", "/api/workspace/pages", { query: { action: "trash" } }),
    get: (id) => request("GET", "/api/workspace/pages", { query: { id } }),
    create: (input) => request("POST", "/api/workspace/pages", { body: input }),
    update: (id, patch, opts = {}) =>
      request("PATCH", "/api/workspace/pages", { query: { id }, body: patch, ...opts }),
    move: (input) =>
      request("POST", "/api/workspace/pages", { query: { action: "move" }, body: input }),
    duplicate: (id) =>
      request("POST", "/api/workspace/pages", { query: { action: "duplicate" }, body: { id } }),
    archive: (id) =>
      request("POST", "/api/workspace/pages", { query: { action: "archive" }, body: { id } }),
    restore: (id) =>
      request("POST", "/api/workspace/pages", { query: { action: "restore" }, body: { id } }),
    remove: (id) => request("DELETE", "/api/workspace/pages", { query: { id } }),
    favorite: (id, favorite) =>
      request("POST", "/api/workspace/pages", {
        query: { action: "favorite" },
        body: { id, favorite },
      }),
    visit: (id) =>
      request("POST", "/api/workspace/pages", { query: { action: "visit" }, body: { id } }),
  },

  blocks: {
    list: (pageId) => request("GET", "/api/workspace/blocks", { query: { pageId } }),
    create: (input) => request("POST", "/api/workspace/blocks", { body: input }),
    update: (id, patch) =>
      request("PATCH", "/api/workspace/blocks", { query: { id }, body: patch }),
    bulkUpdate: (blocks, opts = {}) =>
      request("PATCH", "/api/workspace/blocks", {
        query: { action: "bulk" },
        body: { blocks },
        ...opts,
      }),
    move: (input) =>
      request("POST", "/api/workspace/blocks", { query: { action: "move" }, body: input }),
    duplicate: (id) =>
      request("POST", "/api/workspace/blocks", {
        query: { action: "duplicate" },
        body: { id },
      }),
    remove: (id) => request("DELETE", "/api/workspace/blocks", { query: { id } }),
  },

  files: {
    upload: (file) => request("POST", "/api/workspace/files", { body: file }),
  },
};

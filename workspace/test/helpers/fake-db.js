/**
 * Fake do client Supabase, suficiente para os fluxos do Workspace Engine.
 *
 * Cobre o subconjunto de query builder que os repositórios usam
 * (select/eq/is/in/order/limit/insert/update/upsert/delete/maybeSingle)
 * e emula a cascata de FK que a migration declara. Serve para testar a
 * lógica de árvore, ordenação e isolamento por tenant sem precisar de um
 * Postgres rodando.
 */
import { randomUUID } from "node:crypto";

const DEFAULTS = {
  workspaces: () => ({ slug: "default", name: "Workspace", settings: {} }),
  workspace_databases: () => ({
    page_id: null, title: "Nova tabela", icon_type: null, icon_value: null,
    description: null, source: "native", source_external_id: null,
  }),
  workspace_database_fields: () => ({
    name: "Campo", type: "text", config: {}, is_primary: false,
  }),
  workspace_database_views: () => ({
    name: "Tabela", type: "table",
    filters: { op: "and", conditions: [] }, sorts: [],
    group_by: null, visible_fields: null, field_order: [], layout: {},
  }),
  workspace_sections: () => ({
    name: "Nova seção", icon_type: null, icon_value: null, is_default: false,
  }),
  workspace_pages: () => ({
    database_id: null,
    section_id: null,
    parent_page_id: null,
    title: "",
    icon_type: null,
    icon_value: null,
    cover_type: null,
    cover_value: null,
    cover_position_y: 50,
    cover_height: 220,
    layout_width: "normal",
    visibility: "private",
    properties: {},
    source: "native",
    source_external_id: null,
    is_archived: false,
    archived_at: null,
  }),
  workspace_blocks: () => ({
    tab_id: null,
    parent_block_id: null,
    content: {},
    props: {},
    plain_text: "",
    source: "native",
    source_external_id: null,
  }),
  workspace_favorites: () => ({ target_type: "page" }),
  workspace_recent_items: () => ({ visit_count: 1 }),
  workspace_revisions: () => ({}),
  workspace_files: () => ({}),
};

export function createFakeDb() {
  const tables = new Map();

  const rowsOf = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  /** Emula ON DELETE CASCADE das FKs declaradas na 0002. */
  function cascadeDelete(table, row) {
    if (table === "workspace_pages") {
      for (const child of rowsOf("workspace_pages").filter((r) => r.parent_page_id === row.id)) {
        removeRow("workspace_pages", child);
      }
      for (const block of rowsOf("workspace_blocks").filter((r) => r.page_id === row.id)) {
        removeRow("workspace_blocks", block);
      }
    }
    if (table === "workspace_databases") {
      for (const f of rowsOf("workspace_database_fields").filter((r) => r.database_id === row.id)) {
        removeRow("workspace_database_fields", f);
      }
      for (const v of rowsOf("workspace_database_views").filter((r) => r.database_id === row.id)) {
        removeRow("workspace_database_views", v);
      }
      for (const r of rowsOf("workspace_pages").filter((p) => p.database_id === row.id)) {
        removeRow("workspace_pages", r);
      }
    }
    if (table === "workspace_blocks") {
      for (const child of rowsOf("workspace_blocks").filter((r) => r.parent_block_id === row.id)) {
        removeRow("workspace_blocks", child);
      }
    }
  }

  function removeRow(table, row) {
    const list = rowsOf(table);
    const index = list.indexOf(row);
    if (index >= 0) list.splice(index, 1);
    cascadeDelete(table, row);
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.op = "select";
      this.filters = [];
      this.single = false;
      this.orderBy = null;
      this.limitN = null;
      this.payload = null;
      this.conflict = null;
    }

    select() { return this; }
    eq(column, value) { this.filters.push((r) => r[column] === value); return this; }
    is(column, value) { this.filters.push((r) => (r[column] ?? null) === value); return this; }
    in(column, values) { this.filters.push((r) => values.includes(r[column])); return this; }
    order(column, opts = {}) { this.orderBy = { column, ascending: opts.ascending !== false }; return this; }
    limit(n) { this.limitN = n; return this; }
    maybeSingle() { this.single = true; return this; }

    insert(payload) { this.op = "insert"; this.payload = payload; return this; }
    update(payload) { this.op = "update"; this.payload = payload; return this; }
    upsert(payload, opts = {}) {
      this.op = "upsert";
      this.payload = payload;
      this.conflict = (opts.onConflict || "").split(",").map((c) => c.trim()).filter(Boolean);
      return this;
    }
    delete() { this.op = "delete"; return this; }

    matching() {
      return rowsOf(this.table).filter((row) => this.filters.every((f) => f(row)));
    }

    run() {
      const now = new Date().toISOString();

      if (this.op === "insert") {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
        const created = incoming.map((row) => {
          const full = {
            id: randomUUID(),
            ...(DEFAULTS[this.table]?.() || {}),
            ...row,
            created_at: now,
            updated_at: now,
          };
          rowsOf(this.table).push(full);
          return { ...full };
        });
        return { data: this.single ? created[0] : created, error: null };
      }

      if (this.op === "upsert") {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
        const saved = incoming.map((row) => {
          const existing = this.conflict?.length
            ? rowsOf(this.table).find((r) => this.conflict.every((c) => r[c] === row[c]))
            : null;
          if (existing) {
            Object.assign(existing, row, { updated_at: now });
            return { ...existing };
          }
          const full = {
            id: randomUUID(),
            ...(DEFAULTS[this.table]?.() || {}),
            ...row,
            created_at: now,
            updated_at: now,
          };
          rowsOf(this.table).push(full);
          return { ...full };
        });
        return { data: this.single ? saved[0] : saved, error: null };
      }

      if (this.op === "update") {
        const matched = this.matching();
        matched.forEach((row) => Object.assign(row, this.payload, { updated_at: now }));
        const copy = matched.map((r) => ({ ...r }));
        return { data: this.single ? copy[0] || null : copy, error: null };
      }

      if (this.op === "delete") {
        const matched = this.matching();
        matched.forEach((row) => removeRow(this.table, row));
        return { data: matched.map((r) => ({ ...r })), error: null };
      }

      let rows = this.matching().map((r) => ({ ...r }));
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        rows.sort((a, b) => {
          if (a[column] === b[column]) return 0;
          const result = a[column] < b[column] ? -1 : 1;
          return ascending ? result : -result;
        });
      }
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      return { data: this.single ? rows[0] || null : rows, error: null };
    }

    then(resolve, reject) {
      try {
        resolve(this.run());
      } catch (err) {
        reject(err);
      }
    }
  }

  return {
    from: (table) => new Query(table),
    /** Acesso direto ao estado, para asserções nos testes. */
    __tables: tables,
    __rows: rowsOf,
  };
}

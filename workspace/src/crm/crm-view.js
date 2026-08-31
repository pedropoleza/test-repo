/**
 * Visão de CRM: leads e oportunidades da sub-account no GHL.
 *
 * Somente leitura. Os dados vivem no GHL; o que é NOSSO é a organização —
 * quais colunas mostrar, como filtrar, ordenar e agrupar. Isso fica em
 * localStorage por enquanto; quando virar configuração compartilhada, o
 * lugar é uma view de database (a estrutura já existe).
 *
 * Reaproveita o renderizador de célula e o motor de filtro/ordenação das
 * tabelas nativas: um lead é uma linha como qualquer outra.
 */
import { api } from "../api.js";
import { openMenu, openModal } from "../ui/menu.js";
import { toast } from "../ui/toast.js";
import { renderCellValue } from "../database/cells.js";
import { applySorts, groupRecords, fieldSpec } from "../shared/fields.js";

const PREFS_KEY = "workspace:crmPrefs";

function loadPrefs(kind) {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")[kind] || {};
  } catch {
    return {};
  }
}
function savePrefs(kind, prefs) {
  try {
    const all = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    all[kind] = prefs;
    localStorage.setItem(PREFS_KEY, JSON.stringify(all));
  } catch { /* storage bloqueado: a sessão segue sem lembrar */ }
}

/** Converte a coluna vinda da API no formato de campo que as células usam. */
function toField(col) {
  return {
    key: col.key,
    name: col.name,
    type: col.type,
    is_primary: !!col.primary,
    config: col.options ? { options: col.options } : {},
    source: col.source || "ghl_standard",
  };
}

export function createCrmView(host, { kind = "contacts" } = {}) {
  let columns = [];
  let records = [];
  let meta = {};
  let prefs = {
    visible: null,        // null = só os padrão
    sorts: [],
    groupBy: null,
    search: "",
    ...loadPrefs(kind),
  };

  function persist() {
    savePrefs(kind, prefs);
  }

  async function load() {
    host.replaceChildren(skeleton());
    try {
      const data = kind === "contacts"
        ? await api.crm.contacts(300)
        : await api.crm.opportunities(300);
      columns = (data.columns || []).map(toField);
      records = data.records || [];
      meta = { total: data.total, truncated: data.truncated };
      render();
    } catch (err) {
      host.replaceChildren(errorState(err));
    }
  }

  function skeleton() {
    const box = document.createElement("div");
    box.className = "ws-skeleton";
    for (const w of ["30%", "90%", "80%", "85%", "70%"]) {
      const line = document.createElement("div");
      line.className = "ws-skeleton__line";
      line.style.width = w;
      box.appendChild(line);
    }
    return box;
  }

  /** Erro que diz o que houve, o que foi preservado e como resolver (§78). */
  function errorState(err) {
    const box = document.createElement("div");
    box.className = "ws-error";
    const h = document.createElement("h2");
    const p = document.createElement("p");

    if (err.code === "ghl_not_configured") {
      h.textContent = "CRM não conectado";
      p.textContent = "Falta o token da sub-account (GHL_LOCATION_TOKEN). "
        + "Seu conteúdo do workspace não é afetado.";
    } else if (err.code === "missing_scope") {
      h.textContent = "O token não tem permissão para este recurso";
      p.textContent = err.payload?.fix
        || "Habilite leitura de Contacts, Opportunities, Custom Fields e Tags na Private Integration.";
    } else if (err.code === "invalid_token") {
      h.textContent = "Token do GHL inválido ou revogado";
      p.textContent = "Gere um novo Private Integration Token e atualize a variável.";
    } else {
      h.textContent = "Não foi possível carregar os dados do CRM";
      p.textContent = "O GHL não respondeu. Nada foi alterado.";
    }

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ws-btn";
    retry.textContent = "Tentar de novo";
    retry.addEventListener("click", load);
    box.append(h, p, retry);
    return box;
  }

  function visibleColumns() {
    if (!prefs.visible) {
      // Padrão: só campos padrão. Esta conta tem 115 custom fields — mostrar
      // tudo de saída daria uma tabela de 127 colunas, ilegível.
      return columns.filter((c) => c.source !== "ghl_custom_field");
    }
    const set = new Set(prefs.visible);
    return columns.filter((c) => c.is_primary || set.has(c.key));
  }

  function filtered() {
    const term = prefs.search.trim().toLowerCase();
    let out = records;
    if (term) {
      out = out.filter((r) => {
        if ((r.title || "").toLowerCase().includes(term)) return true;
        return Object.values(r.properties || {}).some((v) =>
          String(Array.isArray(v) ? v.join(" ") : v ?? "").toLowerCase().includes(term));
      });
    }
    const byKey = Object.fromEntries(columns.map((c) => [c.key, c]));
    return applySorts(out, prefs.sorts, byKey);
  }

  function render() {
    host.replaceChildren();
    host.className = "ws-db ws-crm";
    host.appendChild(renderToolbar());

    const rows = filtered();
    const groupField = prefs.groupBy ? columns.find((c) => c.key === prefs.groupBy) : null;

    const scroll = document.createElement("div");
    scroll.className = "ws-db__scroll";
    if (groupField) {
      for (const group of groupRecords(rows, groupField)) {
        const head = document.createElement("div");
        head.className = "ws-db__group";
        const chip = document.createElement("span");
        chip.className = "ws-chip";
        chip.dataset.color = group.color || "gray";
        chip.textContent = group.label || "Sem valor";
        const count = document.createElement("span");
        count.className = "ws-db__group-count";
        count.textContent = group.records.length;
        head.append(chip, count);
        scroll.append(head, renderGrid(group.records));
      }
    } else {
      scroll.appendChild(renderGrid(rows));
    }
    host.appendChild(scroll);

    const foot = document.createElement("div");
    foot.className = "ws-db__foot";
    const count = document.createElement("span");
    count.className = "ws-db__count";
    count.textContent = rows.length === records.length
      ? `${records.length} ${kind === "contacts" ? "leads" : "oportunidades"}`
      : `${rows.length} de ${records.length}`;
    foot.appendChild(count);
    if (meta.truncated) {
      const warn = document.createElement("span");
      warn.className = "ws-db__truncated";
      warn.textContent = "Mostrando os primeiros 300 registros";
      foot.appendChild(warn);
    }
    host.appendChild(foot);
  }

  function renderToolbar() {
    const bar = document.createElement("div");
    bar.className = "ws-db__toolbar";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "ws-input ws-input--sm ws-crm__search";
    search.placeholder = kind === "contacts" ? "Buscar lead…" : "Buscar oportunidade…";
    search.setAttribute("aria-label", "Buscar");
    search.value = prefs.search;
    let timer = null;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        prefs.search = search.value;
        persist();
        render();
        host.querySelector(".ws-crm__search")?.focus();
      }, 220);
    });
    bar.appendChild(search);

    const actions = document.createElement("div");
    actions.className = "ws-db__toolbar-actions";
    actions.append(
      pill(prefs.sorts.length ? `Ordenar · ${prefs.sorts.length}` : "Ordenar", openSort),
      pill(prefs.groupBy
        ? `Agrupar · ${columns.find((c) => c.key === prefs.groupBy)?.name || ""}`
        : "Agrupar", openGroup),
      pill(`Colunas · ${visibleColumns().length}`, openColumns),
      pill("Atualizar", () => load()),
    );
    bar.appendChild(actions);
    return bar;
  }

  function pill(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ws-db__pill";
    b.textContent = label;
    b.addEventListener("click", (e) => onClick(e.currentTarget));
    return b;
  }

  function openSort(anchor) {
    openMenu({
      anchor, width: 280,
      items: [
        ...prefs.sorts.map((s, i) => ({
          id: `rm:${i}`,
          label: `${columns.find((c) => c.key === s.field)?.name || s.field} · ${s.direction === "asc" ? "↑" : "↓"}`,
          icon: "✕", section: "Regras ativas",
        })),
        ...columns.filter((c) => fieldSpec(c.type).sortable).flatMap((c) => [
          { id: `add:${c.key}:asc`, label: `${c.name} ↑`, section: "Adicionar" },
          { id: `add:${c.key}:desc`, label: `${c.name} ↓`, section: "Adicionar" },
        ]),
      ],
      onSelect: (id) => {
        if (id.startsWith("rm:")) {
          prefs.sorts = prefs.sorts.filter((_, i) => i !== Number(id.slice(3)));
        } else {
          const [, field, direction] = id.split(":");
          prefs.sorts = [...prefs.sorts.filter((s) => s.field !== field), { field, direction }];
        }
        persist();
        render();
      },
    });
  }

  function openGroup(anchor) {
    openMenu({
      anchor, width: 240,
      items: [
        { id: "__none__", label: "Sem agrupamento", icon: prefs.groupBy ? " " : "✓" },
        ...columns
          .filter((c) => ["select", "multi_select", "status", "checkbox", "text", "person"].includes(c.type))
          .slice(0, 40)
          .map((c) => ({
            id: c.key, label: c.name, icon: prefs.groupBy === c.key ? "✓" : " ",
            section: "Agrupar por",
          })),
      ],
      onSelect: (id) => {
        prefs.groupBy = id === "__none__" ? null : id;
        persist();
        render();
      },
    });
  }

  /**
   * Seletor de colunas em modal, não em menu: com 115 custom fields um
   * menu vira uma lista infinita sem busca.
   */
  function openColumns() {
    const current = new Set(visibleColumns().map((c) => c.key));
    openModal({
      title: "Colunas",
      width: 520,
      render: (body, close) => {
        const search = document.createElement("input");
        search.type = "search";
        search.className = "ws-input";
        search.placeholder = "Buscar coluna…";
        search.setAttribute("aria-label", "Buscar coluna");

        const list = document.createElement("div");
        list.className = "ws-columns-list";

        const draw = () => {
          const term = search.value.trim().toLowerCase();
          list.replaceChildren();
          for (const col of columns) {
            if (term && !col.name.toLowerCase().includes(term)) continue;
            const row = document.createElement("label");
            row.className = "ws-columns-row";
            const box = document.createElement("input");
            box.type = "checkbox";
            box.className = "ws-checkbox";
            box.checked = current.has(col.key);
            box.disabled = !!col.is_primary;
            box.addEventListener("change", () => {
              if (box.checked) current.add(col.key);
              else current.delete(col.key);
            });
            const name = document.createElement("span");
            name.textContent = col.name;
            const tag = document.createElement("span");
            tag.className = "ws-columns-row__tag";
            tag.textContent = col.source === "ghl_custom_field" ? "custom" : "padrão";
            row.append(box, name, tag);
            list.appendChild(row);
          }
          if (!list.childElementCount) {
            const empty = document.createElement("p");
            empty.className = "ws-muted";
            empty.textContent = "Nenhuma coluna com esse nome.";
            list.appendChild(empty);
          }
        };
        search.addEventListener("input", draw);
        draw();

        const footer = document.createElement("div");
        footer.className = "ws-modal__footer";
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "ws-btn ws-btn--ghost";
        reset.textContent = "Só os padrão";
        reset.addEventListener("click", () => {
          prefs.visible = null;
          persist();
          close(true);
          render();
        });
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "ws-btn ws-btn--primary";
        apply.textContent = "Aplicar";
        apply.addEventListener("click", () => {
          prefs.visible = [...current];
          persist();
          close(true);
          render();
        });
        footer.append(reset, apply);
        body.append(search, list, footer);
      },
    });
  }

  function renderGrid(rows) {
    const cols = visibleColumns();
    const grid = document.createElement("div");
    grid.className = "ws-db__grid";
    grid.style.setProperty("--ws-db-cols", cols.length);
    grid.setAttribute("role", "table");

    const head = document.createElement("div");
    head.className = "ws-db__row ws-db__row--head";
    for (const col of cols) {
      const th = document.createElement("div");
      th.className = "ws-db__th";
      th.setAttribute("role", "columnheader");
      const icon = document.createElement("span");
      icon.className = "ws-db__th-icon";
      icon.textContent = fieldSpec(col.type).icon;
      const name = document.createElement("span");
      name.textContent = col.name;
      th.append(icon, name);
      head.appendChild(th);
    }
    grid.appendChild(head);

    for (const record of rows) {
      const row = document.createElement("div");
      row.className = "ws-db__row";
      row.setAttribute("role", "row");
      cols.forEach((col, index) => {
        const td = document.createElement("div");
        td.className = "ws-db__td ws-db__td--readonly";
        td.setAttribute("role", "cell");
        const value = col.is_primary
          ? { title: record.title, properties: record.properties }
          : record;
        td.appendChild(renderCellValue(col, value));
        if (index === 0 && kind === "contacts") {
          const open = document.createElement("button");
          open.type = "button";
          open.className = "ws-db__open";
          open.textContent = "Detalhes";
          open.addEventListener("click", () => openContact(record));
          td.appendChild(open);
        }
        row.appendChild(td);
      });
      grid.appendChild(row);
    }

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "ws-db__empty";
      empty.textContent = prefs.search
        ? "Nenhum resultado para essa busca."
        : "Nada por aqui ainda.";
      grid.appendChild(empty);
    }
    return grid;
  }

  /** Painel do lead: notas e tarefas, buscadas sob demanda. */
  async function openContact(record) {
    openModal({
      title: record.title,
      width: 620,
      render: async (body) => {
        const loading = document.createElement("p");
        loading.className = "ws-muted";
        loading.textContent = "Carregando notas e tarefas…";
        body.appendChild(loading);

        const props = document.createElement("div");
        props.className = "ws-crm__props";
        for (const col of columns) {
          const raw = col.is_primary ? record.title : record.properties?.[col.key];
          if (raw === undefined || raw === null || raw === "" ||
              (Array.isArray(raw) && !raw.length)) continue;
          const line = document.createElement("div");
          line.className = "ws-crm__prop";
          const k = document.createElement("span");
          k.className = "ws-crm__prop-key";
          k.textContent = col.name;
          const v = document.createElement("span");
          v.className = "ws-crm__prop-value";
          v.appendChild(renderCellValue(col, col.is_primary
            ? { title: record.title, properties: record.properties }
            : record));
          line.append(k, v);
          props.appendChild(line);
        }
        body.insertBefore(props, loading);

        try {
          const data = await api.crm.contact(record.externalId);
          loading.remove();
          body.appendChild(listBlock("Notas", (data.notes || []).map((n) => ({
            text: n.body || n.note || "",
            meta: n.dateAdded || n.createdAt,
          }))));
          body.appendChild(listBlock("Tarefas", (data.tasks || []).map((t) => ({
            text: t.title || t.body || "",
            meta: t.dueDate,
            done: t.completed,
          }))));
        } catch {
          loading.textContent = "Não foi possível carregar notas e tarefas deste lead.";
        }
      },
    });
  }

  function listBlock(title, items) {
    const box = document.createElement("div");
    box.className = "ws-crm__list";
    const h = document.createElement("h3");
    h.className = "ws-crm__list-title";
    h.textContent = `${title} (${items.length})`;
    box.appendChild(h);

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "ws-muted";
      empty.textContent = `Nenhuma ${title.toLowerCase().replace(/s$/, "")} registrada.`;
      box.appendChild(empty);
      return box;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "ws-crm__list-item";
      if (item.done) row.classList.add("is-done");
      const text = document.createElement("span");
      text.textContent = item.text || "—";
      row.appendChild(text);
      if (item.meta) {
        const meta = document.createElement("span");
        meta.className = "ws-crm__list-meta";
        const d = new Date(item.meta);
        meta.textContent = Number.isNaN(d.getTime())
          ? String(item.meta)
          : d.toLocaleDateString("pt-BR");
        row.appendChild(meta);
      }
      box.appendChild(row);
    }
    return box;
  }

  load();
  return { reload: load };
}

export { toast };

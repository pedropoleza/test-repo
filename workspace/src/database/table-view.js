/**
 * View de tabela (§19).
 *
 * Renderiza cabeçalho de colunas + linhas de registros, com edição inline
 * de célula. A view nunca duplica registro: ela pede o bundle já filtrado
 * e ordenado pelo servidor e desenha o que veio.
 */
import { api } from "../api.js";
import { openMenu } from "../ui/menu.js";
import { toast } from "../ui/toast.js";
import { renderCellValue, editCell } from "./cells.js";
import { openFieldEditor, openNewFieldMenu } from "./field-editor.js";
import { renderViewToolbar } from "./view-toolbar.js";
import { fieldSpec, groupRecords } from "../shared/fields.js";

/**
 * Monta a tabela dentro de `host`.
 * `onOpenRecord(recordId)` abre o registro como página completa (§18).
 */
export function createTableView(host, { databaseId, viewId, onOpenRecord }) {
  let bundle = null;
  let activeViewId = viewId || null;

  async function load() {
    try {
      bundle = await api.databases.get(databaseId, activeViewId);
      activeViewId = bundle.viewId;
      render();
    } catch (err) {
      host.replaceChildren(errorBox(
        err.code === "database_not_found"
          ? "Esta tabela não existe mais."
          : "Não foi possível carregar a tabela.",
        () => load(),
      ));
    }
  }

  function errorBox(message, retry) {
    const box = document.createElement("div");
    box.className = "ws-db__error";
    const p = document.createElement("p");
    p.textContent = message;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ws-btn ws-btn--sm";
    btn.textContent = "Tentar de novo";
    btn.addEventListener("click", retry);
    box.append(p, btn);
    return box;
  }

  function visibleFields() {
    const view = currentView();
    const all = bundle.fields;
    if (!view?.visible_fields) return all;
    const allowed = new Set(view.visible_fields);
    return all.filter((f) => f.is_primary || allowed.has(f.key));
  }

  function currentView() {
    return bundle.views.find((v) => v.id === activeViewId) || bundle.views[0] || null;
  }

  function render() {
    host.replaceChildren();
    host.className = "ws-db";

    host.appendChild(renderHeader());
    host.appendChild(renderViewToolbar({
      bundle,
      viewId: activeViewId,
      onSwitchView: (id) => { activeViewId = id; load(); },
      onChangeView: async (patch) => {
        try {
          await api.databases.updateView(activeViewId, patch);
          await load();
        } catch {
          toast("Não foi possível salvar a configuração da vista.", { tone: "danger" });
        }
      },
      onCreateView: async (input) => {
        try {
          const { view } = await api.databases.createView(databaseId, input);
          activeViewId = view.id;
          await load();
        } catch {
          toast("Não foi possível criar a vista.", { tone: "danger" });
        }
      },
      onDeleteView: async (id) => {
        try {
          await api.databases.removeView(id);
          activeViewId = null;
          await load();
        } catch (err) {
          toast(err.code === "cannot_delete_last_view"
            ? "Uma tabela precisa de pelo menos uma vista."
            : "Não foi possível excluir a vista.", { tone: "danger" });
        }
      },
    }));

    const view = currentView();
    const groupField = view?.group_by
      ? bundle.fields.find((f) => f.key === view.group_by)
      : null;

    const scroller = document.createElement("div");
    scroller.className = "ws-db__scroll";

    if (groupField) {
      for (const group of groupRecords(bundle.records, groupField)) {
        scroller.appendChild(renderGroupHeader(group, groupField));
        scroller.appendChild(renderGrid(group.records));
      }
    } else {
      scroller.appendChild(renderGrid(bundle.records));
    }
    host.appendChild(scroller);
    host.appendChild(renderFooter());
  }

  function renderHeader() {
    const head = document.createElement("div");
    head.className = "ws-db__head";

    const title = document.createElement("input");
    title.className = "ws-db__title";
    title.value = bundle.database.title;
    title.setAttribute("aria-label", "Nome da tabela");
    title.addEventListener("change", async () => {
      try {
        await api.databases.update(databaseId, { title: title.value });
        bundle.database.title = title.value;
      } catch {
        toast("Não foi possível renomear a tabela.", { tone: "danger" });
      }
    });

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ws-icon-btn";
    menu.setAttribute("aria-label", "Ações da tabela");
    menu.textContent = "⋯";
    menu.addEventListener("click", () => {
      openMenu({
        anchor: menu,
        width: 220,
        items: [
          { id: "new-field", label: "Nova coluna", icon: "+" },
          { id: "new-record", label: "Nova linha", icon: "≡" },
          { separator: true },
          { id: "delete", label: "Excluir tabela", icon: "🗑", danger: true },
        ],
        onSelect: async (id) => {
          if (id === "new-field") openNewFieldMenu(menu, databaseId, load);
          else if (id === "new-record") addRecord();
          else if (id === "delete") deleteDatabase();
        },
      });
    });

    head.append(title, menu);
    return head;
  }

  function renderGroupHeader(group, field) {
    const el = document.createElement("div");
    el.className = "ws-db__group";
    const chip = document.createElement("span");
    chip.className = "ws-chip";
    chip.dataset.color = group.color || "gray";
    chip.textContent = group.label || "Sem valor";
    const count = document.createElement("span");
    count.className = "ws-db__group-count";
    count.textContent = group.records.length;
    el.append(chip, count);
    el.title = `Agrupado por ${field.name}`;
    return el;
  }

  function renderGrid(records) {
    const fields = visibleFields();
    const grid = document.createElement("div");
    grid.className = "ws-db__grid";
    grid.style.setProperty("--ws-db-cols", fields.length);
    grid.setAttribute("role", "table");

    // ---- cabeçalho ----
    const headRow = document.createElement("div");
    headRow.className = "ws-db__row ws-db__row--head";
    headRow.setAttribute("role", "row");

    for (const field of fields) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "ws-db__th";
      cell.setAttribute("role", "columnheader");
      const icon = document.createElement("span");
      icon.className = "ws-db__th-icon";
      icon.textContent = fieldSpec(field.type).icon;
      const name = document.createElement("span");
      name.textContent = field.name;
      cell.append(icon, name);
      cell.addEventListener("click", () =>
        openFieldEditor(cell, field, { databaseId, onDone: load }));
      headRow.appendChild(cell);
    }

    const addCol = document.createElement("button");
    addCol.type = "button";
    addCol.className = "ws-db__th ws-db__th--add";
    addCol.setAttribute("aria-label", "Adicionar coluna");
    addCol.textContent = "+";
    addCol.addEventListener("click", () => openNewFieldMenu(addCol, databaseId, load));
    headRow.appendChild(addCol);
    grid.appendChild(headRow);

    // ---- linhas ----
    for (const record of records) {
      grid.appendChild(renderRow(record, fields));
    }
    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "ws-db__empty";
      empty.textContent = "Nenhuma linha aqui ainda.";
      grid.appendChild(empty);
    }
    return grid;
  }

  function renderRow(record, fields) {
    const row = document.createElement("div");
    row.className = "ws-db__row";
    row.setAttribute("role", "row");
    row.dataset.recordId = record.id;

    fields.forEach((field, index) => {
      const cell = document.createElement("div");
      cell.className = "ws-db__td";
      cell.setAttribute("role", "cell");
      cell.tabIndex = 0;
      cell.dataset.fieldKey = field.key;

      const paint = () => {
        cell.replaceChildren(renderCellValue(field, record));
        if (index === 0) cell.appendChild(rowOpener(record));
      };
      paint();

      const startEdit = () => {
        if (fieldSpec(field.type).readOnly) return;
        cell.classList.add("is-editing");
        editCell(cell, field, record, {
          commit: (value) => saveCell(record, field, value),
          done: () => {
            cell.classList.remove("is-editing");
            // Só repinta se a célula ainda está na tela: um reload da
            // tabela durante a edição a substitui, e repintar um nó
            // solto estoura "node is no longer a child of this node".
            // A guarda é AQUI, não no paint: durante a construção da
            // tabela as células ainda não estão no documento, e guardar
            // lá deixava a tabela inteira em branco.
            if (cell.isConnected) paint();
          },
        });
      };

      cell.addEventListener("click", (event) => {
        if (event.target.closest(".ws-db__open")) return;
        startEdit();
      });
      cell.addEventListener("keydown", (event) => {
        // Só reage quando a própria célula tem o foco. Sem esta guarda o
        // evento borbulha de dentro do input e a barra de espaço, em vez
        // de escrever um espaço, reabre o editor — era impossível digitar
        // "Proposta ACME" numa célula.
        if (event.target !== cell) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startEdit();
        }
      });
      row.appendChild(cell);
    });

    const actions = document.createElement("div");
    actions.className = "ws-db__td ws-db__td--actions";
    const more = document.createElement("button");
    more.type = "button";
    more.className = "ws-db__row-menu";
    more.setAttribute("aria-label", "Ações da linha");
    more.textContent = "⋯";
    more.addEventListener("click", () => {
      openMenu({
        anchor: more,
        width: 200,
        items: [
          { id: "open", label: "Abrir como página", icon: "↗" },
          { id: "duplicate", label: "Duplicar linha", icon: "⧉" },
          { separator: true },
          { id: "delete", label: "Excluir linha", icon: "🗑", danger: true },
        ],
        onSelect: async (id) => {
          if (id === "open") onOpenRecord?.(record.id);
          else if (id === "duplicate") {
            try {
              await api.databases.createRecord(databaseId, {
                title: `${record.title || "Sem título"} (cópia)`,
                properties: record.properties,
              });
              load();
            } catch { toast("Não foi possível duplicar.", { tone: "danger" }); }
          } else if (id === "delete") {
            try {
              await api.databases.removeRecord(record.id);
              load();
            } catch { toast("Não foi possível excluir.", { tone: "danger" }); }
          }
        },
      });
    });
    actions.appendChild(more);
    row.appendChild(actions);
    return row;
  }

  /** Botão que abre o registro como página — a essência do §18. */
  function rowOpener(record) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "ws-db__open";
    open.textContent = "Abrir";
    open.setAttribute("aria-label", `Abrir ${record.title || "registro"} como página`);
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      onOpenRecord?.(record.id);
    });
    return open;
  }

  async function saveCell(record, field, value) {
    const previous = { ...(record.properties || {}) };
    const previousTitle = record.title;

    // Atualiza o registro local ANTES do request: o repaint acontece no
    // fim da edição, e esperar a rede deixava a célula em branco até a
    // resposta chegar. A coluna principal mora no título da página.
    if (field.is_primary) record.title = String(value ?? "");
    else record.properties = { ...previous, [field.key]: value };

    try {
      const { record: saved } = await api.databases.updateRecord(record.id, {
        properties: { [field.key]: value },
      });
      record.properties = saved.properties;
      // A coluna principal grava no título da página: sem copiar de volta,
      // a célula repintava lendo um título local desatualizado (vazio).
      record.title = saved.title;
      record.updated_at = saved.updated_at;
    } catch {
      record.properties = previous;
      record.title = previousTitle;
      toast("Não foi possível salvar a célula.", { tone: "danger" });
      render();
    }
  }

  function renderFooter() {
    const foot = document.createElement("div");
    foot.className = "ws-db__foot";

    const add = document.createElement("button");
    add.type = "button";
    add.className = "ws-db__add-row";
    add.textContent = "+ Nova linha";
    add.addEventListener("click", addRecord);
    foot.appendChild(add);

    const count = document.createElement("span");
    count.className = "ws-db__count";
    const shown = bundle.records.length;
    const total = bundle.totalRecords;
    count.textContent = shown === total
      ? `${total} ${total === 1 ? "linha" : "linhas"}`
      : `${shown} de ${total} linhas`;
    foot.appendChild(count);

    if (bundle.truncated) {
      const warn = document.createElement("span");
      warn.className = "ws-db__truncated";
      warn.textContent = "Mostrando as primeiras 2000 linhas";
      foot.appendChild(warn);
    }
    return foot;
  }

  async function addRecord() {
    try {
      const { record } = await api.databases.createRecord(databaseId, { title: "" });
      await load();
      // Foca a linha recém-criada pelo id, não pela posição: com
      // ordenação ativa ela pode não ser a última da tela.
      requestAnimationFrame(() => {
        host.querySelector(`[data-record-id="${cssEscape(record.id)}"] .ws-db__td`)?.click();
      });
    } catch {
      toast("Não foi possível criar a linha.", { tone: "danger" });
    }
  }

  function cssEscape(value) {
    return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
  }

  async function deleteDatabase() {
    try {
      await api.databases.remove(databaseId);
      host.dispatchEvent(new CustomEvent("workspace:database-deleted", {
        bubbles: true, detail: { databaseId },
      }));
    } catch {
      toast("Não foi possível excluir a tabela.", { tone: "danger" });
    }
  }

  load();
  return { reload: load };
}

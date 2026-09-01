/**
 * Visão de CRM: leads e oportunidades da sub-account no GHL.
 *
 * Os dados vivem no CRM; o que é NOSSO é a organização —
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
import { renderCellValue, editCell } from "../database/cells.js";
import {
  applySorts, groupRecords, fieldSpec, matchesFilter, operatorsFor, OPERATOR_LABEL,
} from "../shared/fields.js";
import { loadWidths, applyTemplate, attachResizer } from "../database/columns.js";
import { isWritable, isMoveField, openStageMenu, commitField, commitMove } from "./editing.js";

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
    readOnly: !!col.readOnly,
  };
}

export function createCrmView(host, { kind = "contacts", onOpenPage } = {}) {
  let columns = [];
  let records = [];
  let meta = {};
  let dossiers = new Map();   // contactId → pageId
  let pipelines = [];         // com estágios, para mover pela célula
  const widths = loadWidths(`crm:${kind}`);
  let prefs = {
    visible: null,        // null = só os padrão
    sorts: [],
    filters: { op: "and", conditions: [] },
    groupBy: null,
    search: "",
    ...loadPrefs(kind),
  };
  if (!prefs.filters?.conditions) prefs.filters = { op: "and", conditions: [] };

  function persist() {
    savePrefs(kind, prefs);
  }

  async function load() {
    host.replaceChildren(skeleton());
    try {
      const [data, fichas] = await Promise.all([
        kind === "contacts" ? api.crm.contacts(300) : api.crm.opportunities(300),
        kind === "contacts" ? api.crm.dossiers().catch(() => ({ dossiers: [] })) : null,
      ]);
      columns = (data.columns || []).map(toField);
      records = data.records || [];
      pipelines = data.pipelines || [];
      meta = { total: data.total, truncated: data.truncated };
      dossiers = new Map((fichas?.dossiers || []).map((d) => [d.contactId, d.pageId]));
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
      p.textContent = "Falta configurar o token de acesso da conta (SPARK_CRM_TOKEN). "
        + "Seu conteúdo do workspace não é afetado.";
    } else if (err.code === "missing_scope") {
      h.textContent = "O token não tem permissão para este recurso";
      p.textContent = err.payload?.fix
        || "Habilite leitura de Contacts, Opportunities, Custom Fields e Tags na Private Integration.";
    } else if (err.code === "invalid_token") {
      h.textContent = "Token de acesso inválido ou revogado";
      p.textContent = "Gere um novo token de integração e atualize a variável SPARK_CRM_TOKEN.";
    } else {
      h.textContent = "Não foi possível carregar os dados do CRM";
      p.textContent = "O serviço de dados não respondeu. Nada foi alterado.";
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
    const byKey = Object.fromEntries(columns.map((c) => [c.key, c]));
    const term = prefs.search.trim().toLowerCase();
    let out = records.filter((r) => matchesFilter(prefs.filters, r, byKey));
    if (term) {
      out = out.filter((r) => {
        if ((r.title || "").toLowerCase().includes(term)) return true;
        return Object.values(r.properties || {}).some((v) =>
          String(Array.isArray(v) ? v.join(" ") : v ?? "").toLowerCase().includes(term));
      });
    }
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
    const nFiltros = prefs.filters.conditions.length;
    actions.append(
      pill(nFiltros ? `Filtros · ${nFiltros}` : "Filtros", (a) => openFilterSummary(a)),
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
   * Menu da própria coluna: ordenar, filtrar, agrupar e ocultar no lugar
   * onde a pessoa está olhando, em vez de só na barra de cima.
   */
  function openColumnMenu(anchor, col) {
    const ordem = prefs.sorts.find((s) => s.field === col.key);
    const temFiltro = prefs.filters.conditions.some((c) => c.field === col.key);
    const ordenavel = fieldSpec(col.type).sortable;

    openMenu({
      anchor,
      width: 250,
      items: [
        ...(ordenavel ? [
          { id: "asc", label: "Ordenar crescente", icon: ordem?.direction === "asc" ? "✓" : "↑" },
          { id: "desc", label: "Ordenar decrescente", icon: ordem?.direction === "desc" ? "✓" : "↓" },
          ...(ordem ? [{ id: "unsort", label: "Remover ordenação", icon: "×" }] : []),
          { separator: true },
        ] : []),
        { id: "filter", label: temFiltro ? "Editar filtro desta coluna" : "Filtrar por esta coluna", icon: "⚟" },
        ...(temFiltro ? [{ id: "unfilter", label: "Remover filtro desta coluna", icon: "×" }] : []),
        { separator: true },
        { id: "group", label: "Agrupar por esta coluna", icon: "▤" },
        { id: "hide", label: "Ocultar coluna", icon: "◌", disabled: !!col.is_primary },
      ],
      onSelect: (id) => {
        if (id === "asc" || id === "desc") {
          prefs.sorts = [...prefs.sorts.filter((s) => s.field !== col.key),
                         { field: col.key, direction: id }];
        } else if (id === "unsort") {
          prefs.sorts = prefs.sorts.filter((s) => s.field !== col.key);
        } else if (id === "filter") {
          return openColumnFilter(col);
        } else if (id === "unfilter") {
          prefs.filters.conditions = prefs.filters.conditions.filter((c) => c.field !== col.key);
        } else if (id === "group") {
          prefs.groupBy = prefs.groupBy === col.key ? null : col.key;
        } else if (id === "hide") {
          prefs.visible = visibleColumns().map((c) => c.key).filter((k) => k !== col.key);
        }
        persist();
        render();
        return undefined;
      },
    });
  }

  /** Filtro de uma coluna: operador + valor, com as opções que existem. */
  function openColumnFilter(col) {
    const atual = { ...(prefs.filters.conditions.find((c) => c.field === col.key)
      || { field: col.key, operator: operatorsFor(col.type)[0], value: "" }) };

    openModal({
      title: `Filtrar por "${col.name}"`,
      width: 460,
      render: (body, close) => {
        const stack = document.createElement("div");
        stack.className = "ws-stack";

        const op = document.createElement("select");
        op.className = "ws-select";
        op.setAttribute("aria-label", "Operador");
        for (const o of operatorsFor(col.type)) {
          const opt = document.createElement("option");
          opt.value = o;
          opt.textContent = OPERATOR_LABEL[o];
          opt.selected = o === atual.operator;
          op.appendChild(opt);
        }

        const campoValor = document.createElement("div");
        const desenharValor = () => {
          campoValor.replaceChildren();
          if (["is_empty", "is_not_empty"].includes(op.value)) return;

          // Coluna de opção oferece os valores que existem de fato:
          // filtrar digitando o texto exato é pedir erro.
          if (col.config?.options?.length) {
            const sel = document.createElement("select");
            sel.className = "ws-select";
            sel.setAttribute("aria-label", "Valor");
            for (const o of col.config.options) {
              const opt = document.createElement("option");
              opt.value = o.id;
              opt.textContent = o.name;
              opt.selected = o.id === atual.value;
              sel.appendChild(opt);
            }
            sel.addEventListener("change", () => { atual.value = sel.value; });
            if (!atual.value && sel.options.length) atual.value = sel.options[0].value;
            campoValor.appendChild(sel);
            return;
          }
          const input = document.createElement("input");
          input.className = "ws-input";
          input.type = col.type === "date" ? "date" : "text";
          input.setAttribute("aria-label", "Valor");
          input.placeholder = "Valor";
          input.value = atual.value ?? "";
          input.addEventListener("input", () => { atual.value = input.value; });
          campoValor.appendChild(input);
        };
        op.addEventListener("change", () => { atual.operator = op.value; desenharValor(); });
        desenharValor();

        const footer = document.createElement("div");
        footer.className = "ws-modal__footer";
        const limpar = document.createElement("button");
        limpar.type = "button";
        limpar.className = "ws-btn ws-btn--ghost";
        limpar.textContent = "Remover filtro";
        limpar.addEventListener("click", () => {
          prefs.filters.conditions = prefs.filters.conditions.filter((c) => c.field !== col.key);
          persist(); close(true); render();
        });
        const aplicar = document.createElement("button");
        aplicar.type = "button";
        aplicar.className = "ws-btn ws-btn--primary";
        aplicar.textContent = "Aplicar filtro";
        aplicar.addEventListener("click", () => {
          atual.operator = op.value;
          prefs.filters.conditions = [
            ...prefs.filters.conditions.filter((c) => c.field !== col.key),
            atual,
          ];
          persist(); close(true); render();
        });
        footer.append(limpar, aplicar);
        stack.append(op, campoValor, footer);
        body.appendChild(stack);
      },
    });
  }

  /** Resumo dos filtros ativos, para remover um a um ou todos. */
  function openFilterSummary(anchor) {
    const conds = prefs.filters.conditions;
    if (!conds.length) {
      toast("Nenhum filtro ativo. Clique no título de uma coluna para filtrar.", { tone: "info" });
      return;
    }
    openMenu({
      anchor,
      width: 320,
      items: [
        ...conds.map((c, i) => {
          const col = columns.find((x) => x.key === c.field);
          const valor = ["is_empty", "is_not_empty"].includes(c.operator)
            ? "" : ` ${valorLegivel(col, c.value)}`;
          return {
            id: `rm:${i}`,
            label: `${col?.name || c.field} ${OPERATOR_LABEL[c.operator]}${valor}`,
            icon: "✕",
            section: "Filtros ativos",
          };
        }),
        { separator: true },
        { id: "clear", label: "Limpar todos os filtros", icon: "×", danger: true },
      ],
      onSelect: (id) => {
        if (id === "clear") prefs.filters.conditions = [];
        else prefs.filters.conditions.splice(Number(id.slice(3)), 1);
        persist();
        render();
      },
    });
  }

  function valorLegivel(col, valor) {
    if (!col) return String(valor ?? "");
    const opt = (col.config?.options || []).find((o) => o.id === valor);
    return opt ? opt.name : String(valor ?? "");
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
    applyTemplate(grid, cols, widths, { trailing: "96px" });

    const head = document.createElement("div");
    head.className = "ws-db__row ws-db__row--head";
    for (const col of cols) {
      const th = document.createElement("button");
      th.type = "button";
      th.className = "ws-db__th";
      th.setAttribute("role", "columnheader");
      const icon = document.createElement("span");
      icon.className = "ws-db__th-icon";
      icon.textContent = fieldSpec(col.type).icon;
      const name = document.createElement("span");
      name.textContent = col.name;
      th.append(icon, name);

      // Sinais do estado da coluna: sem isso não dá para saber por que a
      // lista está daquele jeito.
      const ordem = prefs.sorts.find((s) => s.field === col.key);
      if (ordem) {
        const seta = document.createElement("span");
        seta.className = "ws-db__th-flag";
        seta.textContent = ordem.direction === "asc" ? "↑" : "↓";
        th.appendChild(seta);
      }
      if (prefs.filters.conditions.some((c) => c.field === col.key)) {
        const funil = document.createElement("span");
        funil.className = "ws-db__th-flag";
        funil.textContent = "⚟";
        funil.title = "Coluna com filtro";
        th.appendChild(funil);
      }

      th.addEventListener("click", (event) => {
        if (event.target.closest(".ws-db__resize")) return;
        openColumnMenu(th, col);
      });
      attachResizer(th, col, {
        scope: `crm:${kind}`, gridEl: grid, fields: cols, widths, trailing: "96px",
      });
      head.appendChild(th);
    }
    const headActions = document.createElement("div");
    headActions.className = "ws-db__th ws-db__th--actions";
    head.appendChild(headActions);
    grid.appendChild(head);

    for (const record of rows) {
      const row = document.createElement("div");
      row.className = "ws-db__row";
      row.setAttribute("role", "row");
      cols.forEach((col) => {
        const td = document.createElement("div");
        td.className = "ws-db__td ws-db__td--readonly";
        td.setAttribute("role", "cell");
        const value = col.is_primary
          ? { title: record.title, properties: record.properties }
          : record;

        // Clicar no nome abre a pasta: é o gesto que a pessoa tenta
        // primeiro, e antes ele não fazia nada.
        if (col.is_primary && (kind === "contacts" || record.contactId)) {
          td.classList.add("ws-db__td--link");
          td.setAttribute("role", "button");
          td.tabIndex = 0;
          const abrir = () => abrirFicha(
            kind === "contacts" ? record : { ...record, externalId: record.contactId },
            td,
          );
          td.addEventListener("click", abrir);
          td.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
          });
          td.title = kind === "contacts"
            ? "Abrir a pasta deste contato"
            : "Abrir a pasta do contato desta oportunidade";
        }

        // Campo gravável vira ação: clicar edita no lugar, sem sair da
        // lista. A coluna primária já tem o clique de abrir a pasta, e
        // roubá-lo para editar quebraria o gesto principal — o nome se
        // edita pela pasta.
        if (record.externalId && !col.is_primary && isWritable(kind, col)) {
          td.classList.remove("ws-db__td--readonly");
          td.classList.add("ws-db__td--action");
          td.setAttribute("role", "button");
          td.tabIndex = 0;
          const mover = isMoveField(kind, col.key);
          const editar = () => (mover ? abrirEstagios(td, record) : editarCelula(td, col, record));
          td.addEventListener("click", (e) => {
            if (e.target !== td && e.target.closest("input, a, .ws-menu")) return;
            editar();
          });
          td.addEventListener("keydown", (e) => {
            if (e.target !== td) return;
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editar(); }
          });
          td.title = mover ? "Mover para outro estágio" : `Alterar ${col.name.toLowerCase()}`;
        }

        td.appendChild(renderCellValue(col, value));
        if (col.is_primary && kind === "contacts" && dossiers.has(record.externalId)) {
          const mark = document.createElement("span");
          mark.className = "ws-db__badge";
          mark.textContent = "pasta";
          mark.title = "Já existe pasta para este contato";
          td.appendChild(mark);
        }
        row.appendChild(td);
      });

      // Ações em coluna própria: empilhadas na primeira célula elas
      // disputavam espaço com o nome e a linha ficava ilegível.
      const acoes = document.createElement("div");
      acoes.className = "ws-db__td ws-db__td--actions";
      if (kind === "opportunities" && record.contactId) {
        const abrir = document.createElement("button");
        abrir.type = "button";
        abrir.className = "ws-db__row-action";
        abrir.textContent = "Pasta";
        abrir.title = "Abrir a pasta do contato desta oportunidade";
        abrir.addEventListener("click", () =>
          abrirFicha({ ...record, externalId: record.contactId }, abrir));
        acoes.appendChild(abrir);
      }
      if (kind === "contacts") {
        const abrir = document.createElement("button");
        abrir.type = "button";
        abrir.className = "ws-db__row-action";
        abrir.textContent = "Pasta";
        abrir.title = "Abrir a pasta deste contato";
        abrir.addEventListener("click", () => abrirFicha(record, abrir));

        const mais = document.createElement("button");
        mais.type = "button";
        mais.className = "ws-db__row-menu";
        mais.textContent = "⋯";
        mais.setAttribute("aria-label", `Ações de ${record.title}`);
        mais.addEventListener("click", () => {
          openMenu({
            anchor: mais, width: 220,
            items: [
              { id: "pasta", label: "Abrir pasta", icon: "📁" },
              { id: "detalhes", label: "Ver dados, notas e tarefas", icon: "👁" },
            ],
            onSelect: (id) => (id === "pasta" ? abrirFicha(record, abrir) : openContact(record)),
          });
        });
        acoes.append(abrir, mais);
      }
      row.appendChild(acoes);
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

  /**
   * Abre a ficha do contato. O servidor é idempotente: se já existe,
   * devolve a mesma página em vez de criar uma segunda.
   */
  async function abrirFicha(record, button) {
    if (!record?.externalId) {
      toast("Esta oportunidade não está ligada a um contato.", { tone: "warn" });
      return;
    }
    const ehBotao = button?.tagName === "BUTTON";
    const rotuloAnterior = ehBotao ? button.textContent : null;
    if (ehBotao) { button.disabled = true; button.textContent = "Abrindo…"; }
    try {
      const { page, created } = await api.crm.openDossier(record.externalId);
      dossiers.set(record.externalId, page.id);
      toast(created ? "Pasta do contato criada." : "Abrindo a pasta.", { tone: "success" });
      onOpenPage?.(page.id);
    } catch (err) {
      toast(err.code === "contact_not_found"
        ? "Este contato não existe mais na sua conta Spark."
        : "Não foi possível abrir a pasta.", { tone: "danger" });
      if (ehBotao) { button.disabled = false; button.textContent = rotuloAnterior; }
    }
  }

  function abrirEstagios(anchor, record) {
    openStageMenu(anchor, record, pipelines, (pipelineId, stageId) =>
      commitMove({ record, pipelines, pipelineId, stageId, repaint: render }));
  }

  /**
   * Edição inline reaproveitando a célula das tabelas nativas: select
   * abre menu, texto e número viram input no lugar. O `done` repinta a
   * grade — sem isso a célula ficaria com o input órfão depois de gravar.
   */
  function editarCelula(td, col, record) {
    editCell(td, col, record, {
      commit: (value) => commitField({ kind, record, field: col, value, repaint: render }),
      done: () => { if (td.isConnected) render(); },
    });
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

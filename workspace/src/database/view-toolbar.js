/**
 * Barra da view: trocar de vista, filtros, ordenação, agrupamento e
 * colunas visíveis (§19–22).
 */
import { openMenu, openModal } from "../ui/menu.js";
import {
  VIEW_TYPES, operatorsFor, OPERATOR_LABEL, fieldSpec, isFieldType,
} from "../shared/fields.js";

export function renderViewToolbar({
  bundle, viewId, onSwitchView, onChangeView, onCreateView, onDeleteView,
}) {
  const view = bundle.views.find((v) => v.id === viewId) || bundle.views[0];
  const bar = document.createElement("div");
  bar.className = "ws-db__toolbar";

  const tabs = document.createElement("div");
  tabs.className = "ws-db__views";
  for (const v of bundle.views) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `ws-db__view${v.id === view?.id ? " is-active" : ""}`;
    tab.textContent = `${VIEW_TYPES[v.type]?.icon || "▦"} ${v.name}`;
    tab.addEventListener("click", () => {
      if (v.id === view?.id) return openViewMenu(tab, v);
      onSwitchView(v.id);
    });
    tabs.appendChild(tab);
  }

  const addView = document.createElement("button");
  addView.type = "button";
  addView.className = "ws-db__view ws-db__view--add";
  addView.textContent = "+";
  addView.setAttribute("aria-label", "Nova vista");
  addView.addEventListener("click", () => {
    openMenu({
      anchor: addView,
      width: 190,
      items: Object.entries(VIEW_TYPES).map(([id, spec]) => ({
        id, label: spec.label, icon: spec.icon,
      })),
      onSelect: (type) => onCreateView({ type }),
    });
  });
  tabs.appendChild(addView);
  bar.appendChild(tabs);

  const actions = document.createElement("div");
  actions.className = "ws-db__toolbar-actions";
  actions.append(
    pill(filterLabel(view), () => openFilterModal(view)),
    pill(sortLabel(view), (e) => openSortMenu(e.currentTarget, view)),
    pill(groupLabel(view), (e) => openGroupMenu(e.currentTarget, view)),
    pill("Colunas", (e) => openFieldsMenu(e.currentTarget, view)),
  );
  bar.appendChild(actions);
  return bar;

  /* ---------------- helpers ---------------- */

  function pill(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ws-db__pill";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function filterLabel(v) {
    const n = countConditions(v?.filters);
    return n ? `Filtros · ${n}` : "Filtros";
  }
  function countConditions(group) {
    if (!group?.conditions) return 0;
    return group.conditions.reduce(
      (acc, c) => acc + (c.conditions ? countConditions(c) : 1), 0);
  }
  function sortLabel(v) {
    const n = (v?.sorts || []).length;
    return n ? `Ordenar · ${n}` : "Ordenar";
  }
  function groupLabel(v) {
    const f = bundle.fields.find((x) => x.key === v?.group_by);
    return f ? `Agrupar · ${f.name}` : "Agrupar";
  }

  function openViewMenu(anchor, v) {
    openMenu({
      anchor,
      width: 210,
      items: [
        { id: "rename", label: "Renomear vista", icon: "✎" },
        ...Object.entries(VIEW_TYPES).map(([id, spec]) => ({
          id: `type:${id}`, label: spec.label, icon: spec.icon,
          disabled: v.type === id, section: "Tipo de vista",
        })),
        { separator: true },
        { id: "delete", label: "Excluir vista", icon: "🗑", danger: true },
      ],
      onSelect: (id) => {
        if (id === "rename") {
          const name = window.prompt("Nome da vista:", v.name);
          if (name) onChangeView({ name });
        } else if (id.startsWith("type:")) {
          onChangeView({ type: id.slice(5) });
        } else if (id === "delete") {
          onDeleteView(v.id);
        }
      },
    });
  }

  function openSortMenu(anchor, v) {
    const sorts = v?.sorts || [];
    const items = [
      ...sorts.map((s, i) => {
        const f = bundle.fields.find((x) => x.key === s.field);
        return {
          id: `remove:${i}`,
          label: `${f?.name || s.field} · ${s.direction === "asc" ? "crescente" : "decrescente"}`,
          icon: "✕",
          section: "Regras ativas",
        };
      }),
      ...bundle.fields
        .filter((f) => fieldSpec(f.type).sortable)
        .flatMap((f) => [
          { id: `add:${f.key}:asc`,  label: `${f.name} ↑`, section: "Adicionar" },
          { id: `add:${f.key}:desc`, label: `${f.name} ↓`, section: "Adicionar" },
        ]),
    ];
    openMenu({
      anchor, width: 260, items,
      onSelect: (id) => {
        if (id.startsWith("remove:")) {
          const i = Number(id.slice(7));
          onChangeView({ sorts: sorts.filter((_, idx) => idx !== i) });
        } else {
          const [, field, direction] = id.split(":");
          onChangeView({ sorts: [...sorts.filter((s) => s.field !== field), { field, direction }] });
        }
      },
    });
  }

  function openGroupMenu(anchor, v) {
    openMenu({
      anchor,
      width: 220,
      items: [
        { id: "__none__", label: "Sem agrupamento", icon: v?.group_by ? " " : "✓" },
        ...bundle.fields
          .filter((f) => ["select", "status", "multi_select", "checkbox", "person", "text"].includes(f.type))
          .map((f) => ({
            id: f.key, label: f.name, icon: v?.group_by === f.key ? "✓" : " ",
            section: "Agrupar por",
          })),
      ],
      onSelect: (id) => onChangeView({ groupBy: id === "__none__" ? "" : id }),
    });
  }

  function openFieldsMenu(anchor, v) {
    const visible = v?.visible_fields;
    const isOn = (f) => f.is_primary || !visible || visible.includes(f.key);
    openMenu({
      anchor,
      width: 230,
      items: bundle.fields.map((f) => ({
        id: f.key,
        label: f.name,
        icon: isOn(f) ? "✓" : " ",
        disabled: f.is_primary,
        section: "Colunas visíveis",
      })),
      onSelect: (key) => {
        const current = visible || bundle.fields.map((f) => f.key);
        const next = current.includes(key)
          ? current.filter((k) => k !== key)
          : [...current, key];
        onChangeView({ visibleFields: next });
      },
    });
  }

  /** Construtor de filtros com AND/OR (§20). */
  function openFilterModal(v) {
    const state = JSON.parse(JSON.stringify(
      v?.filters?.conditions ? v.filters : { op: "and", conditions: [] }));

    openModal({
      title: "Filtros",
      width: 620,
      render: (body, close) => {
        const host = document.createElement("div");
        host.className = "ws-filter";

        const draw = () => {
          host.replaceChildren(renderGroup(state, 0));
        };

        function renderGroup(group, depth) {
          const box = document.createElement("div");
          box.className = "ws-filter__group";
          box.style.marginLeft = `${depth * 14}px`;

          const head = document.createElement("div");
          head.className = "ws-filter__head";
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "ws-btn ws-btn--sm";
          toggle.textContent = group.op === "and" ? "E (todas)" : "OU (qualquer)";
          toggle.addEventListener("click", () => {
            group.op = group.op === "and" ? "or" : "and";
            draw();
          });
          head.appendChild(toggle);
          box.appendChild(head);

          group.conditions.forEach((cond, index) => {
            box.appendChild(cond.conditions
              ? renderGroup(cond, depth + 1)
              : renderCondition(group, cond, index));
          });

          const add = document.createElement("div");
          add.className = "ws-filter__add";
          const addCond = document.createElement("button");
          addCond.type = "button";
          addCond.className = "ws-btn ws-btn--sm";
          addCond.textContent = "+ Condição";
          addCond.addEventListener("click", () => {
            const f = bundle.fields[0];
            group.conditions.push({ field: f.key, operator: operatorsFor(f.type)[0], value: "" });
            draw();
          });
          add.appendChild(addCond);

          if (depth < 2) {
            const addGroup = document.createElement("button");
            addGroup.type = "button";
            addGroup.className = "ws-btn ws-btn--sm";
            addGroup.textContent = "+ Grupo";
            addGroup.addEventListener("click", () => {
              group.conditions.push({ op: "or", conditions: [] });
              draw();
            });
            add.appendChild(addGroup);
          }
          box.appendChild(add);
          return box;
        }

        function renderCondition(group, cond, index) {
          const row = document.createElement("div");
          row.className = "ws-filter__row";
          const field = bundle.fields.find((f) => f.key === cond.field) || bundle.fields[0];

          const fieldSel = document.createElement("select");
          fieldSel.className = "ws-select";
          fieldSel.setAttribute("aria-label", "Campo");
          for (const f of bundle.fields) {
            const opt = document.createElement("option");
            opt.value = f.key;
            opt.textContent = f.name;
            opt.selected = f.key === cond.field;
            fieldSel.appendChild(opt);
          }
          fieldSel.addEventListener("change", () => {
            cond.field = fieldSel.value;
            const nf = bundle.fields.find((f) => f.key === cond.field);
            cond.operator = operatorsFor(nf.type)[0];
            cond.value = "";
            draw();
          });

          const opSel = document.createElement("select");
          opSel.className = "ws-select";
          opSel.setAttribute("aria-label", "Operador");
          for (const op of operatorsFor(field.type)) {
            const opt = document.createElement("option");
            opt.value = op;
            opt.textContent = OPERATOR_LABEL[op];
            opt.selected = op === cond.operator;
            opSel.appendChild(opt);
          }
          opSel.addEventListener("change", () => { cond.operator = opSel.value; draw(); });

          row.append(fieldSel, opSel);

          if (!["is_empty", "is_not_empty"].includes(cond.operator)) {
            row.appendChild(valueInput(field, cond));
          }

          const del = document.createElement("button");
          del.type = "button";
          del.className = "ws-icon-btn";
          del.textContent = "✕";
          del.setAttribute("aria-label", "Remover condição");
          del.addEventListener("click", () => {
            group.conditions.splice(index, 1);
            draw();
          });
          row.appendChild(del);
          return row;
        }

        function valueInput(field, cond) {
          if (["select", "status", "multi_select"].includes(field.type)) {
            const sel = document.createElement("select");
            sel.className = "ws-select";
            sel.setAttribute("aria-label", "Valor");
            for (const o of field.config?.options || []) {
              const opt = document.createElement("option");
              opt.value = o.id;
              opt.textContent = o.name;
              opt.selected = o.id === cond.value;
              sel.appendChild(opt);
            }
            sel.addEventListener("change", () => { cond.value = sel.value; });
            if (!cond.value && sel.options.length) cond.value = sel.options[0].value;
            return sel;
          }
          if (field.type === "checkbox") {
            const sel = document.createElement("select");
            sel.className = "ws-select";
            sel.setAttribute("aria-label", "Valor");
            for (const [val, label] of [["true", "Marcado"], ["false", "Desmarcado"]]) {
              const opt = document.createElement("option");
              opt.value = val;
              opt.textContent = label;
              opt.selected = String(cond.value) === val;
              sel.appendChild(opt);
            }
            sel.addEventListener("change", () => { cond.value = sel.value === "true"; });
            return sel;
          }
          const input = document.createElement("input");
          input.className = "ws-input ws-input--sm";
          input.setAttribute("aria-label", "Valor");
          input.type = field.type === "date" ? "date" : "text";
          input.value = cond.value ?? "";
          input.addEventListener("input", () => { cond.value = input.value; });
          return input;
        }

        draw();
        body.appendChild(host);

        const footer = document.createElement("div");
        footer.className = "ws-modal__footer";
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "ws-btn ws-btn--ghost";
        clear.textContent = "Limpar tudo";
        clear.addEventListener("click", () => {
          onChangeView({ filters: { op: "and", conditions: [] } });
          close(true);
        });
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "ws-btn ws-btn--primary";
        apply.textContent = "Aplicar";
        apply.addEventListener("click", () => {
          onChangeView({ filters: state });
          close(true);
        });
        footer.append(clear, apply);
        body.appendChild(footer);
      },
    });
  }
}

export { isFieldType };

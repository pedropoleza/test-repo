/**
 * Edição de coluna: renomear, trocar tipo, gerir opções, mover e excluir.
 */
import { api } from "../api.js";
import { openMenu, openModal } from "../ui/menu.js";
import { toast } from "../ui/toast.js";
import { FIELD_TYPES, OPTION_COLORS, fieldSpec } from "../shared/fields.js";

const TYPE_ITEMS = Object.entries(FIELD_TYPES).map(([id, spec]) => ({
  id, label: spec.label, icon: spec.icon,
}));

/** Menu "+" do cabeçalho: escolhe o tipo e já cria a coluna. */
export function openNewFieldMenu(anchor, databaseId, onDone) {
  openMenu({
    anchor,
    width: 230,
    items: TYPE_ITEMS.filter((t) => !fieldSpec(t.id).readOnly || t.id.endsWith("_time"))
      .map((t) => ({ ...t, section: "Tipo da coluna" })),
    onSelect: async (type) => {
      try {
        await api.databases.createField(databaseId, {
          name: FIELD_TYPES[type].label,
          type,
          config: ["select", "multi_select", "status"].includes(type)
            ? { options: defaultOptions() }
            : {},
        });
        onDone?.();
      } catch {
        toast("Não foi possível criar a coluna.", { tone: "danger" });
      }
    },
  });
}

function defaultOptions() {
  return [
    { id: "opt_1", name: "Opção 1", color: "blue" },
    { id: "opt_2", name: "Opção 2", color: "green" },
  ];
}

export function openFieldEditor(anchor, field, { databaseId, onDone }) {
  const hasOptions = ["select", "multi_select", "status"].includes(field.type);

  openMenu({
    anchor,
    width: 236,
    items: [
      { id: "rename", label: "Renomear", icon: "✎" },
      { id: "type", label: `Tipo: ${fieldSpec(field.type).label}`, icon: fieldSpec(field.type).icon },
      ...(hasOptions ? [{ id: "options", label: "Editar opções", icon: "◦" }] : []),
      ...(field.type === "number" ? [{ id: "format", label: "Formato do número", icon: "#" }] : []),
      { separator: true },
      { id: "left", label: "Mover para a esquerda", icon: "←" },
      { id: "right", label: "Mover para a direita", icon: "→" },
      { separator: true },
      {
        id: "delete",
        label: field.is_primary ? "Coluna principal (fixa)" : "Excluir coluna",
        icon: "🗑",
        danger: !field.is_primary,
        disabled: field.is_primary,
      },
    ],
    onSelect: async (id) => {
      try {
        if (id === "rename") return renameField(field, onDone);
        if (id === "type") return chooseType(anchor, field, onDone);
        if (id === "options") return editOptions(field, onDone);
        if (id === "format") return chooseFormat(anchor, field, onDone);
        if (id === "left" || id === "right") {
          const neighbours = await api.databases.get(databaseId);
          const fields = neighbours.fields;
          const i = fields.findIndex((f) => f.id === field.id);
          const target = id === "left" ? fields[i - 1] : fields[i + 1];
          if (!target) return;
          await api.databases.moveField(field.id,
            id === "left" ? { beforeId: target.id } : { afterId: target.id });
          onDone?.();
          return;
        }
        if (id === "delete") {
          await api.databases.removeField(field.id);
          toast("Coluna removida. Os valores continuam guardados.", { tone: "info" });
          onDone?.();
        }
      } catch (err) {
        toast(err.code === "cannot_delete_primary_field"
          ? "A coluna principal não pode ser removida."
          : "Não foi possível alterar a coluna.", { tone: "danger" });
      }
    },
  });
}

function renameField(field, onDone) {
  openModal({
    title: "Renomear coluna",
    width: 420,
    render: (body, close) => {
      const input = document.createElement("input");
      input.className = "ws-input";
      input.value = field.name;
      input.setAttribute("aria-label", "Nome da coluna");

      const hint = document.createElement("p");
      hint.className = "ws-muted";
      hint.textContent = "Renomear não move dado nenhum: a chave interna continua a mesma.";

      const footer = document.createElement("div");
      footer.className = "ws-modal__footer";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ws-btn ws-btn--primary";
      save.textContent = "Salvar";
      save.addEventListener("click", async () => {
        try {
          await api.databases.updateField(field.id, { name: input.value.trim() || field.name });
          close(true);
          onDone?.();
        } catch { toast("Não foi possível renomear.", { tone: "danger" }); }
      });
      footer.appendChild(save);
      body.append(input, hint, footer);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); });
    },
  });
}

function chooseType(anchor, field, onDone) {
  openMenu({
    anchor,
    width: 230,
    items: TYPE_ITEMS.map((t) => ({ ...t, disabled: t.id === field.type })),
    onSelect: async (type) => {
      try {
        await api.databases.updateField(field.id, {
          type,
          config: ["select", "multi_select", "status"].includes(type)
            ? (field.config?.options?.length ? field.config : { options: defaultOptions() })
            : {},
        });
        onDone?.();
      } catch { toast("Não foi possível trocar o tipo.", { tone: "danger" }); }
    },
  });
}

function chooseFormat(anchor, field, onDone) {
  openMenu({
    anchor,
    width: 200,
    items: [
      { id: "plain", label: "Número" },
      { id: "currency", label: "Moeda (US$)" },
      { id: "percent", label: "Percentual" },
    ],
    onSelect: async (format) => {
      try {
        await api.databases.updateField(field.id, { config: { ...field.config, format } });
        onDone?.();
      } catch { toast("Não foi possível salvar o formato.", { tone: "danger" }); }
    },
  });
}

function editOptions(field, onDone) {
  const options = (field.config?.options || []).map((o) => ({ ...o }));

  openModal({
    title: `Opções de "${field.name}"`,
    width: 460,
    render: (body, close) => {
      const list = document.createElement("div");
      list.className = "ws-stack";

      const draw = () => {
        list.replaceChildren();
        options.forEach((option, index) => {
          const row = document.createElement("div");
          row.className = "ws-option-row";

          const swatch = document.createElement("button");
          swatch.type = "button";
          swatch.className = "ws-chip ws-chip--button";
          swatch.dataset.color = option.color;
          swatch.textContent = option.name || "—";
          swatch.setAttribute("aria-label", `Cor de ${option.name}`);
          swatch.addEventListener("click", () => {
            openMenu({
              anchor: swatch,
              width: 170,
              items: OPTION_COLORS.map((c) => ({ id: c, label: c, icon: "●" })),
              onSelect: (color) => { option.color = color; draw(); },
            });
          });

          const name = document.createElement("input");
          name.className = "ws-input ws-input--sm";
          name.value = option.name;
          name.setAttribute("aria-label", "Nome da opção");
          name.addEventListener("input", () => { option.name = name.value; });

          const del = document.createElement("button");
          del.type = "button";
          del.className = "ws-icon-btn";
          del.textContent = "✕";
          del.setAttribute("aria-label", `Remover ${option.name}`);
          del.addEventListener("click", () => { options.splice(index, 1); draw(); });

          row.append(swatch, name, del);
          list.appendChild(row);
        });
      };
      draw();

      const add = document.createElement("button");
      add.type = "button";
      add.className = "ws-btn ws-btn--sm";
      add.textContent = "+ Nova opção";
      add.addEventListener("click", () => {
        options.push({
          id: `opt_${Date.now().toString(36)}`,
          name: `Opção ${options.length + 1}`,
          color: OPTION_COLORS[options.length % OPTION_COLORS.length],
        });
        draw();
      });

      const hint = document.createElement("p");
      hint.className = "ws-muted";
      hint.textContent =
        "Remover uma opção não apaga o histórico: registros que a usavam ficam sem valor.";

      const footer = document.createElement("div");
      footer.className = "ws-modal__footer";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ws-btn ws-btn--primary";
      save.textContent = "Salvar opções";
      save.addEventListener("click", async () => {
        try {
          await api.databases.updateField(field.id, {
            config: { ...field.config, options },
          });
          close(true);
          onDone?.();
        } catch { toast("Não foi possível salvar as opções.", { tone: "danger" }); }
      });
      footer.appendChild(save);

      body.append(list, add, hint, footer);
    },
  });
}

/**
 * Diálogo de seção: nome + ícone, usado para criar e para editar.
 *
 * Substitui os window.prompt() que existiam aqui. Prompt não aceita
 * ícone, não valida, não combina com o resto da interface e no mobile
 * aparece como caixa do sistema.
 */
import { openModal, openMenu } from "./ui/menu.js";
import { openIconPicker, renderIcon } from "./icon-picker.js";

/** Ícones sugeridos: cobre a maioria dos casos sem abrir o seletor. */
const SUGGESTED = ["📁", "🎯", "💼", "📣", "💰", "🛠", "📚", "🚀", "👥", "🧭"];

/**
 * Resolve com { name, iconType, iconValue } ou null se cancelado.
 * `section` preenchido = modo edição.
 */
export function openSectionDialog({ section = null } = {}) {
  const isEdit = !!section;
  let iconType = section?.icon_type || null;
  let iconValue = section?.icon_value || null;

  return openModal({
    title: isEdit ? "Editar seção" : "Nova seção",
    width: 460,
    render: (body, close) => {
      const stack = document.createElement("div");
      stack.className = "ws-stack";

      /* ---- linha: ícone + nome ---- */
      const row = document.createElement("div");
      row.className = "ws-section-dialog__row";

      const iconBtn = document.createElement("button");
      iconBtn.type = "button";
      iconBtn.className = "ws-section-dialog__icon";
      iconBtn.setAttribute("aria-label", "Ícone da seção");
      const paintIcon = () => {
        iconBtn.replaceChildren(
          iconType ? renderIcon(iconType, iconValue, { size: 22 }) : textNode("＋"),
        );
        iconBtn.classList.toggle("is-empty", !iconType);
      };
      iconBtn.addEventListener("click", () => {
        openMenu({
          anchor: iconBtn,
          width: 210,
          items: [
            ...SUGGESTED.map((e) => ({ id: `emoji:${e}`, label: e, icon: e, section: "Sugestões" })),
            { separator: true },
            { id: "__more__", label: "Escolher outro ícone…", icon: "🔎" },
            ...(iconType ? [{ id: "__none__", label: "Sem ícone", icon: "×" }] : []),
          ],
          onSelect: async (id) => {
            if (id === "__none__") { iconType = null; iconValue = null; paintIcon(); return; }
            if (id === "__more__") {
              const picked = await openIconPicker({ hasIcon: !!iconType });
              if (picked) { iconType = picked.type; iconValue = picked.value || null; paintIcon(); }
              return;
            }
            iconType = "emoji";
            iconValue = id.slice(6);
            paintIcon();
          },
        });
      });
      paintIcon();

      const name = document.createElement("input");
      name.className = "ws-input";
      name.placeholder = "Nome da seção";
      name.setAttribute("aria-label", "Nome da seção");
      name.value = section?.name || "";
      name.maxLength = 120;

      row.append(iconBtn, name);
      stack.appendChild(row);

      const hint = document.createElement("p");
      hint.className = "ws-muted";
      hint.textContent = isEdit
        ? "Renomear não move nenhuma página."
        : "Seções organizam a navegação. Uma página pode mudar de seção a qualquer momento.";
      stack.appendChild(hint);

      /* ---- rodapé ---- */
      const footer = document.createElement("div");
      footer.className = "ws-modal__footer";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ws-btn ws-btn--ghost";
      cancel.textContent = "Cancelar";
      cancel.addEventListener("click", () => close(null));

      const submit = document.createElement("button");
      submit.type = "button";
      submit.className = "ws-btn ws-btn--primary";
      submit.textContent = isEdit ? "Salvar" : "Criar seção";

      const commit = () => {
        const value = name.value.trim();
        if (!value) {
          name.focus();
          name.classList.add("is-invalid");
          return;
        }
        close({ name: value, iconType, iconValue });
      };
      submit.addEventListener("click", commit);
      name.addEventListener("input", () => name.classList.remove("is-invalid"));
      name.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
      });

      footer.append(cancel, submit);
      stack.appendChild(footer);
      body.appendChild(stack);
      requestAnimationFrame(() => name.focus());
    },
  });
}

function textNode(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

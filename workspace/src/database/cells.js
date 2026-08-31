/**
 * Células da tabela: como cada tipo de propriedade é exibido e editado.
 *
 * Cada tipo devolve um nó já ligado ao `onChange`. O editor de célula é
 * inline — clicar edita no lugar, sem modal (§69: edição direta).
 */
import {
  fieldSpec, readValue, valueToText, isEmptyValue, optionName, optionColor,
  normalizeValue,
} from "../shared/fields.js";
import { openMenu } from "../ui/menu.js";

/** Nó somente-leitura de uma célula. */
export function renderCellValue(field, record) {
  const value = readValue(field, record);
  const wrap = document.createElement("div");
  wrap.className = "ws-cell__value";

  if (isEmptyValue(value) && field.type !== "checkbox") {
    wrap.classList.add("is-empty");
    return wrap;
  }

  switch (field.type) {
    case "checkbox": {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "ws-checkbox";
      box.checked = !!value;
      box.tabIndex = -1;
      box.setAttribute("aria-label", field.name);
      wrap.appendChild(box);
      return wrap;
    }
    case "select":
    case "status": {
      wrap.appendChild(chip(optionName(field, value), optionColor(field, value)));
      return wrap;
    }
    case "multi_select": {
      for (const id of value) wrap.appendChild(chip(optionName(field, id), optionColor(field, id)));
      return wrap;
    }
    case "url": {
      const a = document.createElement("a");
      a.href = value;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = value;
      a.className = "ws-cell__link";
      wrap.appendChild(a);
      return wrap;
    }
    case "email":
    case "phone": {
      const a = document.createElement("a");
      a.href = field.type === "email" ? `mailto:${value}` : `tel:${value}`;
      a.textContent = value;
      a.className = "ws-cell__link";
      wrap.appendChild(a);
      return wrap;
    }
    case "number": {
      wrap.classList.add("is-numeric");
      wrap.textContent = formatNumber(field, value);
      return wrap;
    }
    case "date":
    case "created_time":
    case "last_edited_time": {
      wrap.textContent = formatDate(value);
      return wrap;
    }
    default:
      wrap.textContent = valueToText(field, value);
      return wrap;
  }
}

function chip(text, color) {
  const el = document.createElement("span");
  el.className = "ws-chip";
  el.dataset.color = color || "gray";
  el.textContent = text || "—";
  return el;
}

export function formatNumber(field, value) {
  if (value === null || value === undefined) return "";
  const format = field.config?.format || "plain";
  if (format === "currency") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
  }
  if (format === "percent") return `${value.toLocaleString("pt-BR")}%`;
  return value.toLocaleString("pt-BR");
}

export function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const hasTime = String(value).includes("T");
  return d.toLocaleDateString("pt-BR", hasTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Entra em modo de edição na célula. `commit(value)` recebe o valor já
 * coagido; `done()` sai do modo de edição.
 */
export function editCell(cellEl, field, record, { commit, done }) {
  if (fieldSpec(field.type).readOnly) return;
  const value = readValue(field, record);

  if (field.type === "checkbox") {
    commit(!value);
    done();
    return;
  }

  if (["select", "status", "multi_select"].includes(field.type)) {
    return editOptions(cellEl, field, value, { commit, done });
  }

  const input = document.createElement("input");
  input.className = "ws-cell__input";
  input.type = { date: "date", number: "text", email: "email", url: "url", phone: "tel" }[field.type] || "text";
  input.value = field.type === "date"
    ? String(value || "").slice(0, 10)
    : (value ?? "");
  input.setAttribute("aria-label", field.name);

  cellEl.replaceChildren(input);
  input.focus();
  input.select?.();

  let finished = false;
  const onBlur = () => finish(true);
  const finish = (save) => {
    if (finished) return;
    finished = true;
    // Desliga o blur ANTES de mexer no DOM: repintar a célula remove o
    // input, o que dispara outro blur e reentra aqui no meio da troca de
    // nós ("node is no longer a child of this node").
    input.removeEventListener("blur", onBlur);
    // Se a tabela recarregou por baixo, este input é órfão: gravar aqui
    // sobrescreveria com um valor de uma versão antiga da linha.
    if (save && input.isConnected) commit(normalizeValue(field, input.value));
    done();
  };
  input.addEventListener("blur", onBlur);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); finish(true); }
    else if (event.key === "Escape") { event.preventDefault(); finish(false); }
  });
}

function editOptions(cellEl, field, value, { commit, done }) {
  const options = field.config?.options || [];
  const multi = field.type === "multi_select";
  const selected = multi ? new Set(value || []) : new Set(value ? [value] : []);

  if (!options.length) {
    done();
    return;
  }

  openMenu({
    anchor: cellEl,
    width: 220,
    items: [
      ...options.map((o) => ({
        id: o.id,
        label: o.name,
        icon: selected.has(o.id) ? "✓" : "○",
      })),
      { separator: true },
      { id: "__clear__", label: "Limpar", icon: "×" },
    ],
    onSelect: (id) => {
      if (id === "__clear__") commit(multi ? [] : null);
      else if (!multi) commit(id);
      else {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        commit([...next]);
      }
      done();
    },
  });
}

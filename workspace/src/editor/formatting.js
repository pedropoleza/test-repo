/**
 * Toolbar de formatação inline (§13). Aparece só quando há seleção de
 * texto dentro do editor — contextual, não permanente (§71).
 */
import { toggleMark, applyLink, activeMarks, closestTag } from "./richtext.js";
import { openPrompt } from "../ui/prompt.js";

let bar = null;
let onCommit = null;

const BUTTONS = [
  { mark: "b", label: "Negrito", glyph: "B", shortcut: "Ctrl+B" },
  { mark: "i", label: "Itálico", glyph: "I", shortcut: "Ctrl+I" },
  { mark: "u", label: "Sublinhado", glyph: "U", shortcut: "Ctrl+U" },
  { mark: "s", label: "Tachado", glyph: "S", shortcut: "" },
  { mark: "code", label: "Código", glyph: "</>", shortcut: "" },
  { mark: "link", label: "Link", glyph: "🔗", shortcut: "Ctrl+K" },
];

function build() {
  const el = document.createElement("div");
  el.className = "ws-format";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Formatação de texto");

  for (const item of BUTTONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ws-format__btn ws-format__btn--${item.mark}`;
    button.dataset.mark = item.mark;
    button.title = item.shortcut ? `${item.label} (${item.shortcut})` : item.label;
    button.setAttribute("aria-label", item.label);
    button.textContent = item.glyph;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault(); // preserva a seleção
      if (item.mark === "link") {
        // O diálogo é assíncrono: commitar aqui gravaria antes da escolha.
        promptLink();
        return;
      }
      toggleMark(item.mark);
      onCommit?.();
      refresh();
    });
    el.appendChild(button);
  }
  document.body.appendChild(el);
  return el;
}

/**
 * A seleção se perde quando o foco vai para o diálogo, então guardamos o
 * intervalo antes de abrir e o restauramos na volta — sem isso o link
 * seria aplicado no lugar errado, ou em lugar nenhum.
 */
async function promptLink() {
  const existing = closestTag(window.getSelection()?.anchorNode, "A");
  const current = existing?.getAttribute("href") || "";
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;

  const url = await openPrompt({
    title: current ? "Editar link" : "Adicionar link",
    label: "URL",
    value: current,
    placeholder: "exemplo.com ou https://exemplo.com",
    confirmLabel: current ? "Salvar link" : "Adicionar link",
    removeLabel: "Remover link",
    allowEmpty: true,
    hint: "Sem http, completamos com https://. Também aceita mailto:.",
    validate: (texto) => (SAFE_LINK.test(texto) || !/^[a-z][a-z0-9+.-]*:/i.test(texto)
      ? null
      : "Só links http, https ou mailto."),
  });
  if (url === null) return;                      // cancelou: nada muda

  restaurarSelecao(range);
  const trimmed = url.trim();
  if (trimmed && !/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    applyLink(`https://${trimmed}`);
    return;
  }
  applyLink(trimmed);
  onCommit?.();
}

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function restaurarSelecao(range) {
  if (!range) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function refresh() {
  if (!bar) return;
  const marks = activeMarks();
  bar.querySelectorAll(".ws-format__btn").forEach((button) => {
    button.classList.toggle("is-active", marks.has(button.dataset.mark));
  });
}

/** Mostra/esconde a barra conforme a seleção atual dentro de `root`. */
export function syncFormattingBar(root, commit) {
  onCommit = commit;
  const selection = window.getSelection();

  if (
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    !root.contains(selection.anchorNode)
  ) {
    hideFormattingBar();
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    hideFormattingBar();
    return;
  }

  if (!bar) bar = build();
  bar.hidden = false;
  const box = bar.getBoundingClientRect();
  const top = rect.top - box.height - 8;
  bar.style.top = `${top < 8 ? rect.bottom + 8 : top}px`;
  bar.style.left = `${Math.min(
    Math.max(8, rect.left + rect.width / 2 - box.width / 2),
    window.innerWidth - box.width - 8,
  )}px`;
  refresh();
}

export function hideFormattingBar() {
  if (bar) bar.hidden = true;
}

/** Atalhos de teclado de formatação. Devolve true se consumiu. */
export function handleFormattingShortcut(event, commit) {
  if (!(event.metaKey || event.ctrlKey)) return false;
  const key = event.key.toLowerCase();
  const map = { b: "b", i: "i", u: "u" };
  if (map[key]) {
    event.preventDefault();
    toggleMark(map[key]);
    commit?.();
    refresh();
    return true;
  }
  if (key === "e") {
    event.preventDefault();
    toggleMark("code");
    commit?.();
    return true;
  }
  if (key === "k" && !event.shiftKey) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      event.preventDefault();
      promptLink();
      commit?.();
      return true;
    }
  }
  return false;
}

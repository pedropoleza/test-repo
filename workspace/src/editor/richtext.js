/**
 * Ponte entre o contentEditable e o JSON de rich text.
 *
 * Nunca usamos innerHTML com conteúdo do usuário: a renderização monta
 * nós de DOM um a um, então nada que venha do banco (ou de um import do
 * Notion) pode virar markup executável.
 */
import { normalizeRich, MARKS } from "../shared/blocks.js";

const TAG_BY_MARK = { b: "strong", i: "em", u: "u", s: "s", code: "code" };

const MARK_BY_TAG = {
  B: "b", STRONG: "b",
  I: "i", EM: "i",
  U: "u",
  S: "s", STRIKE: "s", DEL: "s",
  CODE: "code",
};

/** rich[] → DocumentFragment */
export function renderRich(rich) {
  const frag = document.createDocumentFragment();
  const spans = normalizeRich(rich);
  if (!spans.length) return frag;

  for (const span of spans) {
    let node = document.createTextNode(span.s);

    for (const mark of MARKS) {
      if (span.m?.includes(mark)) {
        const wrapper = document.createElement(TAG_BY_MARK[mark]);
        wrapper.appendChild(node);
        node = wrapper;
      }
    }

    if (span.mention) {
      const mention = document.createElement("span");
      mention.className = "ws-mention";
      mention.dataset.mentionType = span.mention.type;
      mention.dataset.mentionId = span.mention.id;
      mention.contentEditable = "false";
      mention.appendChild(node);
      node = mention;
    } else if (span.href) {
      const link = document.createElement("a");
      link.href = span.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(node);
      node = link;
    }

    frag.appendChild(node);
  }
  return frag;
}

/** contentEditable → rich[] */
export function serializeRich(root) {
  const out = [];
  walk(root, { marks: [], href: null, mention: null }, out);
  return normalizeRich(out);
}

function walk(node, inherited, out) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.nodeValue;
      if (!text) continue;
      const span = { s: text };
      if (inherited.marks.length) span.m = [...inherited.marks];
      if (inherited.href) span.href = inherited.href;
      if (inherited.mention) span.mention = inherited.mention;
      out.push(span);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    if (child.tagName === "BR") {
      out.push({ s: "\n" });
      continue;
    }

    const next = {
      marks: [...inherited.marks],
      href: inherited.href,
      mention: inherited.mention,
    };

    const mark = MARK_BY_TAG[child.tagName];
    if (mark && !next.marks.includes(mark)) next.marks.push(mark);
    if (child.tagName === "A" && child.getAttribute("href")) {
      next.href = child.getAttribute("href");
    }
    if (child.dataset?.mentionId) {
      next.mention = {
        type: child.dataset.mentionType || "page",
        id: child.dataset.mentionId,
        label: child.textContent || "",
      };
    }
    // Estilos inline vindos de colagem: mapeados para marks conhecidas e
    // descartados no resto — não guardamos CSS do usuário.
    const style = child.style;
    if (style) {
      if ((style.fontWeight === "bold" || Number(style.fontWeight) >= 600) &&
          !next.marks.includes("b")) next.marks.push("b");
      if (style.fontStyle === "italic" && !next.marks.includes("i")) next.marks.push("i");
    }

    walk(child, next, out);
  }
}

/* ------------------------------------------------------------------ */
/* Formatação inline (§13)                                            */
/* ------------------------------------------------------------------ */

export function toggleMark(mark) {
  const commands = { b: "bold", i: "italic", u: "underline", s: "strikeThrough" };
  if (commands[mark]) {
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(commands[mark], false, null);
    return;
  }
  if (mark === "code") toggleCode();
}

function toggleCode() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const existing = closestTag(range.commonAncestorContainer, "CODE");

  if (existing) {
    const parent = existing.parentNode;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    parent.removeChild(existing);
    return;
  }
  const code = document.createElement("code");
  try {
    range.surroundContents(code);
  } catch {
    // Seleção atravessando limites de elemento: extrai e reinsere.
    code.appendChild(range.extractContents());
    range.insertNode(code);
  }
}

export function applyLink(url) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  if (!url) {
    document.execCommand("unlink", false, null);
    return;
  }
  document.execCommand("createLink", false, url);
  const link = closestTag(window.getSelection()?.anchorNode, "A");
  if (link) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
}

export function activeMarks() {
  const marks = new Set();
  try {
    if (document.queryCommandState("bold")) marks.add("b");
    if (document.queryCommandState("italic")) marks.add("i");
    if (document.queryCommandState("underline")) marks.add("u");
    if (document.queryCommandState("strikeThrough")) marks.add("s");
  } catch {
    /* navegador sem queryCommandState: toolbar apenas não destaca */
  }
  const anchor = window.getSelection()?.anchorNode;
  if (closestTag(anchor, "CODE")) marks.add("code");
  if (closestTag(anchor, "A")) marks.add("link");
  return marks;
}

export function closestTag(node, tagName) {
  let cur = node;
  while (cur && cur !== document.body) {
    if (cur.nodeType === Node.ELEMENT_NODE && cur.tagName === tagName) return cur;
    cur = cur.parentNode;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Caret                                                              */
/* ------------------------------------------------------------------ */

export function focusEditable(el, { atEnd = true } = {}) {
  if (!el) return;
  el.focus({ preventScroll: false });
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Offset do caret em caracteres — usado para dividir/mesclar blocos. */
export function caretOffset(el) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return 0;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
  return range.toString().length;
}

export function isCaretAtStart(el) {
  return caretOffset(el) === 0;
}

export function isCaretAtEnd(el) {
  return caretOffset(el) >= (el.textContent || "").length;
}

/** Divide os spans de um bloco na posição do caret (Enter no meio do texto). */
export function splitRich(rich, offset) {
  const spans = normalizeRich(rich);
  const before = [];
  const after = [];
  let consumed = 0;
  for (const span of spans) {
    const start = consumed;
    const end = consumed + span.s.length;
    if (end <= offset) before.push(span);
    else if (start >= offset) after.push(span);
    else {
      before.push({ ...span, s: span.s.slice(0, offset - start) });
      after.push({ ...span, s: span.s.slice(offset - start) });
    }
    consumed = end;
  }
  return [normalizeRich(before), normalizeRich(after)];
}

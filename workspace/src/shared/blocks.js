/**
 * Registro de tipos de bloco + normalização de rich text.
 *
 * Compartilhado entre browser (editor) e servidor (API), no mesmo padrão
 * de src/config/tiers.js, que já é importado pelos dois lados. Ter uma
 * fonte única evita que o editor salve algo que a API rejeita.
 *
 * MODELO DE RICH TEXT (§68 — JSON, não colunas):
 *   rich = [{ s: "texto", m: ["b","i"], href?: "https://…", mention?: {...} }]
 * Um span sem marks é texto puro. A renderização monta nós de DOM
 * programaticamente — nunca innerHTML — então o conteúdo é inerte por
 * construção.
 */

export const MARKS = ["b", "i", "u", "s", "code"];

/**
 * `rich`      → bloco guarda texto formatado em content.rich
 * `children`  → bloco aceita blocos filhos (nesting)
 * `void`      → bloco sem texto editável (divider, image…)
 */
export const BLOCK_TYPES = {
  paragraph:      { group: "text", rich: true,  children: false, placeholder: "Escreva algo, ou digite '/' para comandos" },
  heading1:       { group: "text", rich: true,  children: false, placeholder: "Título 1" },
  heading2:       { group: "text", rich: true,  children: false, placeholder: "Título 2" },
  heading3:       { group: "text", rich: true,  children: false, placeholder: "Título 3" },
  heading4:       { group: "text", rich: true,  children: false, placeholder: "Título 4" },
  bulleted_list:  { group: "list", rich: true,  children: true,  placeholder: "Item" },
  numbered_list:  { group: "list", rich: true,  children: true,  placeholder: "Item" },
  checklist:      { group: "list", rich: true,  children: true,  placeholder: "To-do" },
  toggle:         { group: "list", rich: true,  children: true,  placeholder: "Toggle" },
  quote:          { group: "text", rich: true,  children: false, placeholder: "Citação" },
  callout:        { group: "text", rich: true,  children: true,  placeholder: "Destaque" },
  code:           { group: "text", rich: false, children: false, placeholder: "// código" },
  divider:        { group: "text", rich: false, children: false, void: true },
  image:          { group: "media", rich: false, children: false, void: true },
  video:          { group: "media", rich: false, children: false, void: true },
  file:           { group: "media", rich: false, children: false, void: true },
  embed:          { group: "media", rich: false, children: false, void: true },
  bookmark:       { group: "media", rich: false, children: false, void: true },
  subpage:        { group: "structure", rich: false, children: false, void: true },
  /**
   * Fallback obrigatório (§52). Qualquer tipo desconhecido — inclusive
   * bloco do Notion ainda não suportado — vira `unsupported` guardando o
   * payload original, em vez de quebrar a página inteira.
   */
  unsupported:    { group: "system", rich: false, children: false, void: true },
};

export function isBlockType(type) {
  return Object.prototype.hasOwnProperty.call(BLOCK_TYPES, type);
}

export function blockSpec(type) {
  return BLOCK_TYPES[type] || BLOCK_TYPES.unsupported;
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export function safeUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!SAFE_URL.test(trimmed)) return null;
  if (trimmed.length > 2048) return null;
  return trimmed;
}

/** Normaliza (e sanitiza) um array de spans vindo do cliente ou de um import. */
export function normalizeRich(value) {
  if (typeof value === "string") {
    return value ? [{ s: value }] : [];
  }
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const s = typeof raw.s === "string" ? raw.s : "";
    if (!s) continue;
    const span = { s: s.slice(0, 20000) };
    if (Array.isArray(raw.m)) {
      const marks = MARKS.filter((m) => raw.m.includes(m));
      if (marks.length) span.m = marks;
    }
    const href = safeUrl(raw.href);
    if (href) span.href = href;
    if (raw.mention && typeof raw.mention === "object") {
      const { type, id, label } = raw.mention;
      if (typeof type === "string" && typeof id === "string") {
        span.mention = { type, id, label: typeof label === "string" ? label : "" };
      }
    }
    // Junta spans adjacentes com formatação idêntica — mantém o JSON enxuto.
    const prev = out[out.length - 1];
    if (prev && sameFormatting(prev, span)) prev.s += span.s;
    else out.push(span);
  }
  return out;
}

function sameFormatting(a, b) {
  if (a.href !== b.href) return false;
  if (!!a.mention || !!b.mention) return false;
  const ma = (a.m || []).join(",");
  const mb = (b.m || []).join(",");
  return ma === mb;
}

export function richToPlainText(rich) {
  return normalizeRich(rich)
    .map((span) => (span.mention ? span.mention.label || span.s : span.s))
    .join("");
}

export function plainTextToRich(text) {
  return text ? [{ s: String(text) }] : [];
}

function clampString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Devolve `{ content, plainText }` já validados para persistência.
 * Campos desconhecidos são descartados: o cliente não define o schema.
 */
export function normalizeBlockContent(type, rawContent) {
  const content = rawContent && typeof rawContent === "object" ? rawContent : {};
  const spec = blockSpec(type);
  const out = {};

  if (spec.rich) {
    out.rich = normalizeRich(content.rich);
  }

  switch (type) {
    case "checklist":
      out.checked = content.checked === true;
      break;
    case "toggle":
      out.expanded = content.expanded !== false;
      break;
    case "callout":
      out.emoji = clampString(content.emoji, 8) || "💡";
      out.tone = ["neutral", "info", "success", "warn", "danger"].includes(content.tone)
        ? content.tone
        : "info";
      break;
    case "code":
      out.text = clampString(content.text, 100000);
      out.language = clampString(content.language, 32) || "plain";
      break;
    case "image":
    case "video":
    case "file":
      out.url = safeUrl(content.url) || "";
      out.fileId = clampString(content.fileId, 64) || null;
      out.name = clampString(content.name, 300);
      out.caption = normalizeRich(content.caption);
      if (type === "image") out.alt = clampString(content.alt, 500);
      break;
    case "embed":
    case "bookmark":
      out.url = safeUrl(content.url) || "";
      out.title = clampString(content.title, 300);
      out.description = clampString(content.description, 1000);
      break;
    case "subpage":
      out.pageId = clampString(content.pageId, 64);
      break;
    case "unsupported":
      out.originalType = clampString(content.originalType, 120) || "unknown";
      out.originalPayload =
        content.originalPayload && typeof content.originalPayload === "object"
          ? content.originalPayload
          : {};
      out.externalUrl = safeUrl(content.externalUrl) || "";
      break;
    default:
      break;
  }

  return { content: out, plainText: plainTextFor(type, out) };
}

function plainTextFor(type, content) {
  if (type === "code") return content.text || "";
  if (type === "bookmark" || type === "embed") {
    return [content.title, content.description, content.url].filter(Boolean).join(" ");
  }
  if (type === "image" || type === "video" || type === "file") {
    return [content.name, richToPlainText(content.caption)].filter(Boolean).join(" ");
  }
  return richToPlainText(content.rich);
}

export function defaultContentFor(type) {
  return normalizeBlockContent(type, {}).content;
}

/** Props visuais (cor, alinhamento) — §12. */
export const TEXT_COLORS = [
  "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
];

export function normalizeBlockProps(rawProps) {
  const props = rawProps && typeof rawProps === "object" ? rawProps : {};
  const out = {};
  if (TEXT_COLORS.includes(props.color) && props.color !== "default") out.color = props.color;
  if (TEXT_COLORS.includes(props.background) && props.background !== "default") {
    out.background = props.background;
  }
  if (["left", "center", "right"].includes(props.align)) out.align = props.align;
  return out;
}

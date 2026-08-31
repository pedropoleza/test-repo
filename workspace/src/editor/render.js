/**
 * Renderização de blocos: JSON → DOM.
 *
 * Puramente estrutural. Os listeners vivem em editor.js por delegação —
 * uma página com centenas de blocos não pode registrar milhares de
 * handlers (§75). Todo estado necessário vai em data-attributes.
 */
import { blockSpec } from "../shared/blocks.js";
import { renderRich } from "./richtext.js";

const HEADING_TAG = { heading1: "h1", heading2: "h2", heading3: "h3", heading4: "h4" };

/** Constrói o elemento de um bloco e, recursivamente, seus filhos. */
export function renderBlock(block, { childrenOf, ordinal = 1 }) {
  const spec = blockSpec(block.type);

  const root = document.createElement("div");
  root.className = `ws-block ws-block--${block.type}`;
  root.dataset.blockId = block.id;
  root.dataset.type = block.type;
  if (block.props?.color) root.dataset.color = block.props.color;
  if (block.props?.background) root.dataset.background = block.props.background;
  if (block.props?.align) root.dataset.align = block.props.align;

  root.appendChild(renderGutter());

  const body = document.createElement("div");
  body.className = "ws-block__body";
  body.appendChild(renderBody(block, spec, ordinal));

  if (spec.children) {
    const children = childrenOf(block.id);
    const wrap = document.createElement("div");
    wrap.className = "ws-block__children";
    if (block.type === "toggle" && block.content?.expanded === false) {
      wrap.hidden = true;
    }
    let n = 1;
    for (const child of children) {
      wrap.appendChild(
        renderBlock(child, {
          childrenOf,
          ordinal: child.type === "numbered_list" ? n++ : 1,
        }),
      );
      if (child.type !== "numbered_list") n = 1;
    }
    body.appendChild(wrap);
  }

  root.appendChild(body);
  return root;
}

function renderGutter() {
  const gutter = document.createElement("div");
  gutter.className = "ws-block__gutter";
  gutter.contentEditable = "false";

  const add = document.createElement("button");
  add.type = "button";
  add.className = "ws-block__add";
  add.dataset.action = "add-below";
  add.setAttribute("aria-label", "Inserir bloco abaixo");
  add.textContent = "+";

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "ws-block__handle";
  handle.dataset.action = "block-menu";
  handle.draggable = true;
  handle.setAttribute("aria-label", "Mover ou abrir ações do bloco");
  handle.textContent = "⠿";

  gutter.append(add, handle);
  return gutter;
}

function editable(block, spec, extraClass = "") {
  const el = document.createElement("div");
  el.className = `ws-text ${extraClass}`.trim();
  el.contentEditable = "true";
  el.spellcheck = true;
  el.dataset.editable = "rich";
  el.dataset.placeholder = spec.placeholder || "";
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-multiline", "false");

  const rich = block.content?.rich || [];
  el.appendChild(renderRich(rich));
  if (!el.textContent) el.classList.add("is-empty");
  return el;
}

function renderBody(block, spec, ordinal) {
  switch (block.type) {
    case "heading1":
    case "heading2":
    case "heading3":
    case "heading4": {
      const wrap = document.createElement(HEADING_TAG[block.type]);
      wrap.className = "ws-heading";
      wrap.appendChild(editable(block, spec));
      return wrap;
    }

    case "bulleted_list":
      return withMarker(block, spec, "•", "ws-marker--bullet");

    case "numbered_list":
      return withMarker(block, spec, `${ordinal}.`, "ws-marker--number");

    case "checklist": {
      const row = document.createElement("div");
      row.className = "ws-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "ws-checkbox";
      box.dataset.action = "toggle-check";
      box.checked = block.content?.checked === true;
      box.setAttribute("aria-label", "Concluído");
      const text = editable(block, spec, block.content?.checked ? "is-checked" : "");
      row.append(box, text);
      return row;
    }

    case "toggle": {
      const row = document.createElement("div");
      row.className = "ws-row";
      const caret = document.createElement("button");
      caret.type = "button";
      caret.className = "ws-toggle-caret";
      caret.dataset.action = "toggle-expand";
      caret.setAttribute(
        "aria-expanded",
        block.content?.expanded === false ? "false" : "true",
      );
      caret.setAttribute("aria-label", "Expandir ou recolher");
      caret.textContent = "▸";
      row.append(caret, editable(block, spec));
      return row;
    }

    case "quote": {
      const quote = document.createElement("blockquote");
      quote.className = "ws-quote";
      quote.appendChild(editable(block, spec));
      return quote;
    }

    case "callout": {
      const card = document.createElement("div");
      card.className = `ws-callout ws-callout--${block.content?.tone || "info"}`;
      const emoji = document.createElement("button");
      emoji.type = "button";
      emoji.className = "ws-callout__emoji";
      emoji.dataset.action = "callout-emoji";
      emoji.setAttribute("aria-label", "Trocar ícone do destaque");
      emoji.textContent = block.content?.emoji || "💡";
      card.append(emoji, editable(block, spec));
      return card;
    }

    case "code": {
      const wrap = document.createElement("div");
      wrap.className = "ws-code";
      const lang = document.createElement("span");
      lang.className = "ws-code__lang";
      lang.textContent = block.content?.language || "plain";
      const pre = document.createElement("pre");
      pre.className = "ws-code__body";
      pre.contentEditable = "true";
      pre.spellcheck = false;
      pre.dataset.editable = "plain";
      pre.dataset.placeholder = spec.placeholder || "";
      pre.textContent = block.content?.text || "";
      if (!pre.textContent) pre.classList.add("is-empty");
      wrap.append(lang, pre);
      return wrap;
    }

    case "divider": {
      const wrap = document.createElement("div");
      wrap.className = "ws-divider-wrap";
      wrap.appendChild(document.createElement("hr"));
      return wrap;
    }

    case "image":
      return renderMedia(block, "image");
    case "video":
      return renderMedia(block, "video");
    case "file":
      return renderMedia(block, "file");

    case "embed":
    case "bookmark":
      return renderLinkCard(block);

    case "subpage":
      return renderSubpageLink(block);

    case "database":
      return renderDatabaseMount(block);

    case "unsupported":
      return renderUnsupported(block);

    default: {
      const wrap = document.createElement("div");
      wrap.className = "ws-paragraph";
      wrap.appendChild(editable(block, spec));
      return wrap;
    }
  }
}

function withMarker(block, spec, markerText, markerClass) {
  const row = document.createElement("div");
  row.className = "ws-row";
  const marker = document.createElement("span");
  marker.className = `ws-marker ${markerClass}`;
  marker.contentEditable = "false";
  marker.textContent = markerText;
  row.append(marker, editable(block, spec));
  return row;
}

const MEDIA_LABEL = { image: "imagem", video: "vídeo", file: "arquivo" };

function renderMedia(block, kind) {
  const wrap = document.createElement("figure");
  wrap.className = `ws-media ws-media--${kind}`;
  const url = block.content?.url;

  if (!url) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "ws-media__empty";
    empty.dataset.action = "pick-media";
    empty.textContent = `Adicionar ${MEDIA_LABEL[kind]}`;
    wrap.appendChild(empty);
    return wrap;
  }

  if (kind === "image") {
    const img = document.createElement("img");
    img.src = url;
    img.alt = block.content?.alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    wrap.appendChild(img);
  } else if (kind === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.preload = "metadata";
    wrap.appendChild(video);
  } else {
    const link = document.createElement("a");
    link.className = "ws-file-card";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = block.content?.name || url;
    wrap.appendChild(link);
  }

  const caption = document.createElement("figcaption");
  caption.className = "ws-text ws-caption";
  caption.contentEditable = "true";
  caption.dataset.editable = "caption";
  caption.dataset.placeholder = "Legenda";
  caption.appendChild(renderRich(block.content?.caption || []));
  if (!caption.textContent) caption.classList.add("is-empty");
  wrap.appendChild(caption);
  return wrap;
}

function renderLinkCard(block) {
  const url = block.content?.url;
  if (!url) {
    const wrap = document.createElement("div");
    wrap.className = "ws-media";
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "ws-media__empty";
    empty.dataset.action = "pick-media";
    empty.textContent = block.type === "embed" ? "Adicionar embed" : "Adicionar link";
    wrap.appendChild(empty);
    return wrap;
  }

  if (block.type === "embed") {
    const wrap = document.createElement("div");
    wrap.className = "ws-embed";
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.loading = "lazy";
    frame.title = block.content?.title || "Conteúdo incorporado";
    // Embed é conteúdo de terceiros: roda isolado, sem acesso ao nosso
    // documento nem à sessão do usuário.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    frame.setAttribute("referrerpolicy", "no-referrer");
    wrap.appendChild(frame);
    return wrap;
  }

  const card = document.createElement("a");
  card.className = "ws-bookmark";
  card.href = url;
  card.target = "_blank";
  card.rel = "noopener noreferrer";

  const title = document.createElement("span");
  title.className = "ws-bookmark__title";
  title.textContent = block.content?.title || url;
  const host = document.createElement("span");
  host.className = "ws-bookmark__host";
  host.textContent = safeHost(url);
  card.append(title, host);
  return card;
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function renderSubpageLink(block) {
  const link = document.createElement("a");
  link.className = "ws-subpage-link";
  link.href = `?p=${encodeURIComponent(block.content?.pageId || "")}`;
  link.dataset.action = "open-subpage";
  link.dataset.pageId = block.content?.pageId || "";
  link.textContent = block.content?.title || "Subpágina";
  return link;
}

/**
 * O bloco de database só reserva o espaço; quem monta a tabela é o
 * editor, que tem acesso à navegação para abrir registros como página.
 */
function renderDatabaseMount(block) {
  const mount = document.createElement("div");
  mount.className = "ws-db-mount";
  mount.dataset.databaseId = block.content?.databaseId || "";
  mount.dataset.viewId = block.content?.viewId || "";
  if (!block.content?.databaseId) {
    mount.textContent = "Tabela não encontrada.";
    mount.classList.add("is-broken");
  }
  return mount;
}

/**
 * Bloco não suportado (§52): mostra que existe, preserva o payload e
 * oferece o original. Nunca some silenciosamente e nunca quebra a página.
 */
function renderUnsupported(block) {
  const card = document.createElement("div");
  card.className = "ws-unsupported";

  const label = document.createElement("span");
  label.className = "ws-unsupported__label";
  label.textContent = `Bloco não suportado · ${block.content?.originalType || "desconhecido"}`;
  card.appendChild(label);

  if (block.content?.externalUrl) {
    const link = document.createElement("a");
    link.href = block.content.externalUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "ws-unsupported__link";
    link.textContent = "Abrir original";
    card.appendChild(link);
  }
  return card;
}

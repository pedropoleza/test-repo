/**
 * Block editor.
 *
 * Um controller por página aberta. Todos os listeners são delegados no
 * container — nenhuma página registra handler por bloco (§75).
 *
 * Fluxo de escrita:
 *   digitar → commit() atualiza o store e marca o bloco sujo
 *           → autosave com debounce manda um PATCH bulk
 *   estrutura (criar/mover/converter/excluir) → chamada imediata à API,
 *           com atualização otimista do store e re-render.
 */
import { api } from "../api.js";
import {
  getState, setState, blockChildrenOf, blockById, upsertBlock, removeBlock,
} from "../store.js";
import { blockSpec, normalizeBlockContent } from "../shared/blocks.js";
import { keyBetween } from "../shared/fracdex.js";
import { renderBlock } from "./render.js";
import {
  serializeRich, focusEditable, caretOffset, isCaretAtStart, isCaretAtEnd, splitRich,
} from "./richtext.js";
import { openSlashMenu } from "./slash-menu.js";
import { openBlockMenu } from "./block-menu.js";
import { syncFormattingBar, hideFormattingBar, handleFormattingShortcut } from "./formatting.js";
import { initDnd } from "./dnd.js";
import { openModal, openMenu, closeMenu } from "../ui/menu.js";
import { uploadFile, MAX_UPLOAD_BYTES } from "../cover.js";
import { createTableView } from "../database/table-view.js";
import { createContactPanel } from "../crm/contact-panel.js";
import { openContactPicker } from "../crm/contact-picker.js";
import { openCopyLink } from "../ui/prompt.js";
import { openIconPicker } from "../icon-picker.js";

/** Emojis mais usados em destaque; o seletor completo fica a um clique. */
const CALLOUT_EMOJIS = ["💡", "⚠️", "✅", "❌", "📌", "🔥", "ℹ️", "⭐", "🎯", "📝"];
import { toast } from "../ui/toast.js";

const AUTOSAVE_DELAY_MS = 700;
const MAX_RETRY_DELAY_MS = 30000;

const TEXT_TYPES = new Set([
  "paragraph", "heading1", "heading2", "heading3", "heading4",
  "bulleted_list", "numbered_list", "checklist", "toggle", "quote", "callout",
]);

const MEDIA_TYPES = new Set(["image", "video", "file", "embed", "bookmark"]);

/** Markdown ao digitar: "# " vira Título 1 e assim por diante. */
const MARKDOWN_PREFIX = [
  [/^#\s$/, "heading1"],
  [/^##\s$/, "heading2"],
  [/^###\s$/, "heading3"],
  [/^####\s$/, "heading4"],
  [/^[-*]\s$/, "bulleted_list"],
  [/^1\.\s$/, "numbered_list"],
  [/^\[\]\s$/, "checklist"],
  [/^\[\s?\]\s$/, "checklist"],
  [/^>\s$/, "quote"],
  [/^```$/, "code"],
];

export function createEditor(root) {
  const dirty = new Map();
  let saveTimer = null;
  let retryDelay = 1000;
  let slash = null;
  let focusAfterRender = null;

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  function render() {
    const top = blockChildrenOf(null);
    root.replaceChildren();

    let ordinal = 1;
    for (const block of top) {
      root.appendChild(
        renderBlock(block, {
          childrenOf: blockChildrenOf,
          ordinal: block.type === "numbered_list" ? ordinal++ : 1,
        }),
      );
      if (block.type !== "numbered_list") ordinal = 1;
    }

    if (!top.length) root.appendChild(emptyHint());

    if (focusAfterRender) {
      const { blockId, atEnd } = focusAfterRender;
      focusAfterRender = null;
      requestAnimationFrame(() => focusBlock(blockId, { atEnd }));
    }

    mountDatabases();
    mountCrmPanels();
  }

  function emptyHint() {
    const hint = document.createElement("button");
    hint.type = "button";
    hint.className = "ws-empty-editor";
    hint.dataset.action = "seed-first-block";
    hint.textContent = "Clique aqui e comece a escrever, ou digite / para ver os blocos";
    return hint;
  }

  function focusBlock(blockId, { atEnd = true } = {}) {
    const el = root.querySelector(`[data-block-id="${cssEscape(blockId)}"] [data-editable]`);
    if (el) focusEditable(el, { atEnd });
    return el;
  }

  function cssEscape(value) {
    return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
  }

  function elementFor(node) {
    const host = node.closest?.("[data-block-id]");
    if (!host) return null;
    return { id: host.dataset.blockId, type: host.dataset.type, el: host };
  }

  /* ------------------------------------------------------------------ */
  /* Autosave (§36)                                                     */
  /* ------------------------------------------------------------------ */

  function markDirty(blockId, patch) {
    dirty.set(blockId, { ...(dirty.get(blockId) || {}), ...patch, id: blockId });
    setState({ saveState: "saving" }, "save-state");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, AUTOSAVE_DELAY_MS);
  }

  async function flush({ keepalive = false } = {}) {
    if (!dirty.size) {
      setState({ saveState: "saved" }, "save-state");
      return;
    }
    const batch = [...dirty.values()];
    dirty.clear();

    try {
      await api.blocks.bulkUpdate(batch, { keepalive });
      retryDelay = 1000;
      setState({ saveState: dirty.size ? "saving" : "saved" }, "save-state");
    } catch (err) {
      // Devolve o lote à fila sem descartar o que o usuário digitou
      // depois: patches novos vencem os antigos.
      for (const patch of batch) {
        dirty.set(patch.id, { ...patch, ...(dirty.get(patch.id) || {}) });
      }
      setState({ saveState: "error" }, "save-state");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
      if (err.status === 401 || err.status === 403) {
        toast("Sessão expirada. Recarregue a página para continuar editando.", {
          tone: "danger",
          timeout: 8000,
        });
      }
    }
  }

  /** Lê o DOM do bloco e devolve o content atualizado. */
  function readContent(block, editableEl) {
    const kind = editableEl.dataset.editable;
    const content = { ...(block.content || {}) };
    if (kind === "plain") content.text = editableEl.textContent || "";
    else if (kind === "caption") content.caption = serializeRich(editableEl);
    else content.rich = serializeRich(editableEl);
    return normalizeBlockContent(block.type, content).content;
  }

  function commit(blockId, editableEl) {
    const block = blockById(blockId);
    if (!block) return;
    const content = readContent(block, editableEl);
    upsertBlock({ ...block, content });
    markDirty(blockId, { content });
  }

  /* ------------------------------------------------------------------ */
  /* Operações estruturais                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Criação otimista: o bloco aparece e recebe o caret ANTES da resposta
   * da API. Sem isso, quem digita rápido perde os primeiros caracteres
   * depois do Enter, esperando um round-trip de rede.
   *
   * O id é gerado no cliente e enviado junto; o servidor o aceita se for
   * um UUID e recalcula a posição autoritativa, que substitui a nossa na
   * reconciliação. Cliente e servidor usam o mesmo fractional indexing,
   * então na prática as duas chaves coincidem.
   */
  async function createBlockAfter(reference, { type = "paragraph", content = {}, focus = true }) {
    const pageId = getState().currentPageId;
    const parentBlockId = reference?.parent_block_id || null;
    const id = newId();

    const optimistic = {
      id,
      page_id: pageId,
      tab_id: null,
      parent_block_id: parentBlockId,
      type,
      content: normalizeBlockContent(type, content).content,
      props: {},
      position: nextPosition(parentBlockId, reference),
    };
    upsertBlock(optimistic);
    if (focus) focusAfterRender = { blockId: id, atEnd: false };
    render();

    try {
      const { block } = await api.blocks.create({
        id,
        pageId,
        type,
        content,
        afterId: reference?.id,
        parentBlockId,
      });
      upsertBlock(block);
      return block;
    } catch (err) {
      removeBlock(id);
      render();
      toast("Não foi possível criar o bloco. Tente de novo.", { tone: "danger" });
      throw err;
    }
  }

  function newId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    // Fallback para contextos sem randomUUID (http em rede local).
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /** Mesma conta que o servidor faz, para a ordem otimista bater. */
  function nextPosition(parentBlockId, reference) {
    const siblings = blockChildrenOf(parentBlockId);
    if (!siblings.length) return keyBetween(null, null);
    const index = reference ? siblings.findIndex((b) => b.id === reference.id) : -1;
    if (index >= 0) {
      return keyBetween(siblings[index].position, siblings[index + 1]?.position || null);
    }
    return keyBetween(siblings[siblings.length - 1].position, null);
  }

  async function turnInto(block, type) {
    if (block.type === type) return block;
    const previous = { type: block.type, content: block.content };
    // Otimista: a conversão precisa parecer instantânea ao digitar "# ".
    const { content } = normalizeBlockContent(type, carryContent(block, type));
    upsertBlock({ ...block, type, content });
    focusAfterRender = { blockId: block.id, atEnd: true };
    render();

    try {
      const { block: saved } = await api.blocks.update(block.id, { type, content });
      upsertBlock(saved);
    } catch {
      upsertBlock({ ...block, ...previous });
      render();
      toast("Não foi possível converter o bloco.", { tone: "danger" });
    }
    return blockById(block.id);
  }

  /** Preserva o texto ao trocar de tipo (§12 "Turn into"). */
  function carryContent(block, nextType) {
    const source = block.content || {};
    if (nextType === "code") {
      return { text: (source.rich || []).map((s) => s.s).join("") };
    }
    if (block.type === "code") return { rich: [{ s: source.text || "" }] };
    return { ...source, rich: source.rich || [] };
  }

  async function deleteBlock(block, { focusPrevious = true } = {}) {
    const previous = previousEditableBlock(block);
    removeBlock(block.id);
    if (focusPrevious && previous) focusAfterRender = { blockId: previous.id, atEnd: true };
    render();
    try {
      await api.blocks.remove(block.id);
    } catch {
      toast("Não foi possível excluir o bloco.", { tone: "danger" });
      await reload();
    }
  }

  async function moveBlock(id, { parentBlockId, afterId, beforeId }) {
    try {
      const { block } = await api.blocks.move({ id, parentBlockId, afterId, beforeId });
      upsertBlock(block);
      render();
    } catch (err) {
      toast(
        err.code === "cannot_move_into_descendant"
          ? "Um bloco não pode ser movido para dentro de si mesmo."
          : "Não foi possível mover o bloco.",
        { tone: "danger" },
      );
      await reload();
    }
  }

  async function reload() {
    const pageId = getState().currentPageId;
    if (!pageId) return;
    const { blocks } = await api.blocks.list(pageId);
    setState({ blocks }, "blocks");
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Navegação entre blocos                                             */
  /* ------------------------------------------------------------------ */

  function flatOrder() {
    const out = [];
    const walk = (parentId) => {
      for (const block of blockChildrenOf(parentId)) {
        out.push(block);
        if (blockSpec(block.type).children) walk(block.id);
      }
    };
    walk(null);
    return out;
  }

  function previousEditableBlock(block) {
    const order = flatOrder();
    const index = order.findIndex((b) => b.id === block.id);
    for (let i = index - 1; i >= 0; i -= 1) {
      if (blockSpec(order[i].type).rich || order[i].type === "code") return order[i];
    }
    return null;
  }

  function neighbourBlock(block, direction) {
    const order = flatOrder();
    const index = order.findIndex((b) => b.id === block.id);
    return order[index + direction] || null;
  }

  function previousSibling(block) {
    const siblings = blockChildrenOf(block.parent_block_id || null);
    const index = siblings.findIndex((b) => b.id === block.id);
    return index > 0 ? siblings[index - 1] : null;
  }

  /* ------------------------------------------------------------------ */
  /* Slash menu                                                         */
  /* ------------------------------------------------------------------ */

  function openSlash(blockId, editableEl) {
    closeSlash();
    const rect = caretRect(editableEl);
    // O estado vai por closure: o menu fecha ANTES de entregar a escolha,
    // então `slash` já é null quando o comando chega.
    const state = { blockId, startOffset: Math.max(0, caretOffset(editableEl) - 1) };
    state.controller = openSlashMenu({
      rect,
      onPick: (cmd) => applySlashCommand(cmd, state),
      onClose: () => {
        if (slash === state) slash = null;
      },
    });
    slash = state;
  }

  function closeSlash() {
    slash?.controller.close();
    slash = null;
  }

  function caretRect(fallbackEl) {
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width || rect.height || rect.top) return rect;
    }
    return fallbackEl.getBoundingClientRect();
  }

  /** Remove o "/consulta" digitado e devolve o rich resultante. */
  function stripSlashQuery(editableEl, startOffset) {
    const rich = serializeRich(editableEl);
    const end = caretOffset(editableEl);
    const [before] = splitRich(rich, startOffset);
    const [, after] = splitRich(rich, end);
    return [...before, ...after];
  }

  async function applySlashCommand(cmd, state) {
    if (!state) return;
    const block = blockById(state.blockId);
    const editableEl = root.querySelector(
      `[data-block-id="${cssEscape(state.blockId)}"] [data-editable]`,
    );
    if (!block || !editableEl) return;

    const rich = stripSlashQuery(editableEl, state.startOffset);
    closeSlash();

    if (TEXT_TYPES.has(cmd.id)) {
      const content = { ...(block.content || {}), rich };
      upsertBlock({ ...block, content });
      await turnInto(blockById(block.id), cmd.id);
      markDirty(block.id, { content: normalizeBlockContent(cmd.id, content).content });
      return;
    }

    if (cmd.id === "code") {
      await turnInto(block, "code");
      return;
    }

    // Blocos void: o bloco atual guarda o texto que sobrou; o novo entra
    // logo abaixo (ou substitui o bloco, se ele ficou vazio).
    const leftoverEmpty = rich.every((span) => !span.s.trim());
    const content = { ...(block.content || {}), rich };

    if (leftoverEmpty && blockSpec(block.type).rich) {
      // Limpa o "/comando" digitado antes de despachar. Sem isto o texto
      // "/tabela" ficava como parágrafo solto acima do bloco criado.
      upsertBlock({ ...block, content });
      markDirty(block.id, { content: normalizeBlockContent(block.type, content).content });

      if (cmd.id === "divider") {
        await turnInto(block, "divider");
        await createBlockAfter(blockById(block.id), { type: "paragraph" });
        return;
      }
      if (cmd.id === "subpage") return insertSubpage(block);
      if (cmd.id === "crm_contact") return insertContact(block);
      if (cmd.id === "database" || cmd.id === "database_board") {
        return insertDatabase(block, cmd.id === "database_board");
      }
      await turnInto(block, cmd.id);
      if (MEDIA_TYPES.has(cmd.id)) await promptMedia(blockById(block.id));
      return;
    }

    upsertBlock({ ...block, content });
    markDirty(block.id, { content: normalizeBlockContent(block.type, content).content });

    if (cmd.id === "subpage") return insertSubpage(block);
    if (cmd.id === "crm_contact") return insertContact(block);
    if (cmd.id === "database" || cmd.id === "database_board") {
      return insertDatabase(block, cmd.id === "database_board");
    }
    const created = await createBlockAfter(block, { type: cmd.id, focus: false });
    if (MEDIA_TYPES.has(cmd.id)) await promptMedia(created);
    if (cmd.id === "divider") await createBlockAfter(created, { type: "paragraph" });
  }

  /**
   * Insere o cartão de dados de um contato.
   *
   * O bloco é o mesmo da ficha, então tudo o que vale lá vale aqui:
   * campos editáveis, oportunidades, mover de estágio. Numa página comum
   * ele vira peça de comparação ou de uma capa de família.
   */
  async function insertContact(afterBlock) {
    const escolhido = await openContactPicker({ title: "Dados de contato" });
    if (!escolhido) return;
    try {
      const bloco = await createBlockAfter(afterBlock, {
        type: "crm_contact",
        content: { contactId: escolhido.id },
        focus: false,
      });
      // Um parágrafo depois: sem ele não há onde escrever abaixo do
      // cartão, porque o bloco é void.
      await createBlockAfter(bloco, { type: "paragraph" });
      render();
      toast(`Dados de ${escolhido.nome} adicionados.`, { tone: "success" });
    } catch {
      toast("Não foi possível adicionar o contato.", { tone: "danger" });
    }
  }

  /** Cria uma subpágina real e referencia no conteúdo (§5). */
  async function insertSubpage(afterBlock) {
    const parentId = getState().currentPageId;
    try {
      const { page } = await api.pages.create({ parentPageId: parentId, title: "" });
      const block = await createBlockAfter(afterBlock, {
        type: "subpage",
        content: { pageId: page.id },
        focus: false,
      });
      root.dispatchEvent(
        new CustomEvent("workspace:page-created", { bubbles: true, detail: { page } }),
      );
      return block;
    } catch {
      toast("Não foi possível criar a subpágina.", { tone: "danger" });
      return null;
    }
  }

  /**
   * Cria a database e o bloco que a exibe. A database nasce com campos
   * padrão e uma view, então a tabela já aparece utilizável.
   */
  async function insertDatabase(afterBlock, asBoard) {
    const pageId = getState().currentPageId;
    try {
      const { database } = await api.databases.create({ pageId, title: "Nova tabela" });
      let viewId = null;
      if (asBoard) {
        const full = await api.databases.get(database.id);
        const status = full.fields.find((f) => f.type === "status") || full.fields[1];
        const { view } = await api.databases.createView(database.id, {
          type: "board", name: "Quadro",
        });
        if (status) await api.databases.updateView(view.id, { groupBy: status.key });
        viewId = view.id;
      }
      const block = await createBlockAfter(afterBlock, {
        type: "database",
        content: { databaseId: database.id, viewId },
        focus: false,
      });
      await createBlockAfter(block, { type: "paragraph" });
      return block;
    } catch {
      toast("Não foi possível criar a tabela.", { tone: "danger" });
      return null;
    }
  }

  /** Monta uma tabela em cada bloco de database presente na página. */
  /**
   * Painéis do CRM: mesma mecânica das tabelas montadas. `data-mounted`
   * evita refazer o fetch a cada repintura do editor — o painel se
   * recarrega sozinho quando precisa.
   */
  function mountCrmPanels() {
    for (const mount of root.querySelectorAll(".ws-crm-mount[data-contact-id]")) {
      if (mount.dataset.mounted === "1" || !mount.dataset.contactId) continue;
      mount.dataset.mounted = "1";
      createContactPanel(mount, { contactId: mount.dataset.contactId });
    }
  }

  function mountDatabases() {
    for (const mount of root.querySelectorAll(".ws-db-mount[data-database-id]")) {
      if (mount.dataset.mounted === "1" || !mount.dataset.databaseId) continue;
      mount.dataset.mounted = "1";
      createTableView(mount, {
        databaseId: mount.dataset.databaseId,
        viewId: mount.dataset.viewId || null,
        onOpenRecord: (recordId) => {
          root.dispatchEvent(new CustomEvent("workspace:navigate", {
            bubbles: true, detail: { pageId: recordId },
          }));
        },
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mídia                                                              */
  /* ------------------------------------------------------------------ */

  async function promptMedia(block) {
    if (!block) return;
    const isUploadable = ["image", "video", "file"].includes(block.type);

    const result = await openModal({
      title: mediaTitle(block.type),
      width: 480,
      render: (body, close) => {
        const stack = document.createElement("div");
        stack.className = "ws-stack";

        const url = document.createElement("input");
        url.type = "url";
        url.className = "ws-input";
        url.placeholder = "https://…";
        url.setAttribute("aria-label", "URL");
        url.value = block.content?.url || "";

        const useUrl = document.createElement("button");
        useUrl.type = "button";
        useUrl.className = "ws-btn ws-btn--primary";
        useUrl.textContent = "Usar URL";
        useUrl.addEventListener("click", () => {
          const value = url.value.trim();
          if (!/^https?:\/\//i.test(value)) {
            toast("Informe uma URL http(s) válida.", { tone: "warn" });
            return;
          }
          close({ url: value });
        });
        stack.append(url, useUrl);

        if (isUploadable) {
          const divider = document.createElement("p");
          divider.className = "ws-muted";
          divider.textContent = `ou envie um arquivo (até ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`;

          const file = document.createElement("input");
          file.type = "file";
          file.className = "ws-input";
          file.setAttribute("aria-label", "Arquivo");
          if (block.type === "image") file.accept = "image/*";
          if (block.type === "video") file.accept = "video/*";

          const status = document.createElement("p");
          status.className = "ws-muted";

          file.addEventListener("change", async () => {
            const picked = file.files?.[0];
            if (!picked) return;
            if (picked.size > MAX_UPLOAD_BYTES) {
              status.textContent = "Arquivo grande demais.";
              return;
            }
            status.textContent = "Enviando…";
            try {
              const saved = await uploadFile(picked);
              close({ url: saved.public_url, name: saved.original_name, fileId: saved.id });
            } catch (err) {
              status.textContent =
                err.code === "storage_unavailable"
                  ? "Storage indisponível. Verifique o bucket workspace-files."
                  : "Falha no envio. Tente novamente ou use uma URL.";
            }
          });
          stack.append(divider, file, status);
        }

        body.appendChild(stack);
      },
    });

    if (!result) return;
    const content = { ...(block.content || {}), ...result };
    upsertBlock({ ...block, content });
    render();
    markDirty(block.id, { content: normalizeBlockContent(block.type, content).content });
  }

  function mediaTitle(type) {
    return {
      image: "Imagem", video: "Vídeo", file: "Arquivo",
      embed: "Embed", bookmark: "Bookmark",
    }[type] || "Mídia";
  }

  /* ------------------------------------------------------------------ */
  /* Eventos                                                            */
  /* ------------------------------------------------------------------ */

  root.addEventListener("input", (event) => {
    const editableEl = event.target.closest("[data-editable]");
    if (!editableEl) return;
    const host = elementFor(editableEl);
    if (!host) return;

    editableEl.classList.toggle("is-empty", !editableEl.textContent);

    const text = editableEl.textContent || "";

    // Markdown ao digitar — só no começo do bloco.
    if (editableEl.dataset.editable === "rich") {
      for (const [pattern, type] of MARKDOWN_PREFIX) {
        if (pattern.test(text)) {
          const block = blockById(host.id);
          if (block && block.type !== type) {
            upsertBlock({ ...block, content: { ...block.content, rich: [] } });
            turnInto(blockById(host.id), type);
            markDirty(host.id, { content: normalizeBlockContent(type, { rich: [] }).content });
            return;
          }
        }
      }
    }

    if (slash?.blockId === host.id) {
      const query = text.slice(slash.startOffset + 1, caretOffset(editableEl));
      if (query.includes("\n") || !slash.controller.setQuery(query)) {
        if (query.length > 12) closeSlash();
      }
    }

    commit(host.id, editableEl);
  });

  root.addEventListener("keydown", (event) => {
    if (slash?.controller.handleKey(event)) return;

    const editableEl = event.target.closest("[data-editable]");
    if (!editableEl) return;
    const host = elementFor(editableEl);
    if (!host) return;
    const block = blockById(host.id);
    if (!block) return;

    if (handleFormattingShortcut(event, () => commit(host.id, editableEl))) return;

    if (event.key === "/" && editableEl.dataset.editable === "rich") {
      // Abre depois que o "/" entra no DOM, para o offset bater.
      setTimeout(() => openSlash(host.id, editableEl), 0);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateBlock(block);
      return;
    }

    switch (event.key) {
      case "Enter":
        if (event.shiftKey) return; // quebra de linha no mesmo bloco
        if (editableEl.dataset.editable === "plain") return; // código: Enter é literal
        event.preventDefault();
        handleEnter(block, editableEl);
        return;

      case "Backspace":
        if (!isCaretAtStart(editableEl)) return;
        event.preventDefault();
        handleBackspaceAtStart(block, editableEl);
        return;

      case "Tab":
        event.preventDefault();
        if (event.shiftKey) outdent(block);
        else indent(block);
        return;

      case "ArrowUp": {
        if (caretOffset(editableEl) !== 0) return;
        const prev = neighbourBlock(block, -1);
        if (!prev) return;
        event.preventDefault();
        focusBlock(prev.id, { atEnd: true });
        return;
      }

      case "ArrowDown": {
        if (!isCaretAtEnd(editableEl)) return;
        const next = neighbourBlock(block, 1);
        if (!next) return;
        event.preventDefault();
        focusBlock(next.id, { atEnd: false });
        return;
      }

      case "Escape":
        closeSlash();
        hideFormattingBar();
        return;

      default:
    }
  });

  async function handleEnter(block, editableEl) {
    closeSlash();
    const rich = serializeRich(editableEl);
    const offset = caretOffset(editableEl);
    const [before, after] = splitRich(rich, offset);

    // Enter num item de lista vazio sai da lista (comportamento esperado).
    const isEmptyList =
      ["bulleted_list", "numbered_list", "checklist", "toggle"].includes(block.type) &&
      !rich.some((span) => span.s.trim());
    if (isEmptyList) {
      await turnInto(block, "paragraph");
      return;
    }

    const keepType = ["bulleted_list", "numbered_list", "checklist"].includes(block.type)
      ? block.type
      : "paragraph";

    const updated = { ...(block.content || {}), rich: before };
    upsertBlock({ ...block, content: updated });
    markDirty(block.id, { content: normalizeBlockContent(block.type, updated).content });

    await createBlockAfter(block, { type: keepType, content: { rich: after } });
  }

  async function handleBackspaceAtStart(block, editableEl) {
    // Primeiro: desfaz o tipo. Backspace num título vira parágrafo.
    if (block.type !== "paragraph" && blockSpec(block.type).rich) {
      await turnInto(block, "paragraph");
      return;
    }

    const rich = serializeRich(editableEl);
    const target = previousEditableBlock(block);
    if (!target) return;

    const merged = [...(target.content?.rich || []), ...rich];
    const caretAt = (target.content?.rich || []).reduce((n, span) => n + span.s.length, 0);

    const content = { ...(target.content || {}), rich: merged };
    upsertBlock({ ...target, content });
    markDirty(target.id, { content: normalizeBlockContent(target.type, content).content });

    removeBlock(block.id);
    render();
    const el = focusBlock(target.id, { atEnd: true });
    if (el) placeCaret(el, caretAt);

    try {
      await api.blocks.remove(block.id);
    } catch {
      await reload();
    }
  }

  function placeCaret(el, offset) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode();
    while (node) {
      if (remaining <= node.nodeValue.length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      remaining -= node.nodeValue.length;
      node = walker.nextNode();
    }
  }

  async function indent(block) {
    const sibling = previousSibling(block);
    if (!sibling || !blockSpec(sibling.type).children) return;
    const children = blockChildrenOf(sibling.id);
    focusAfterRender = { blockId: block.id, atEnd: true };
    await moveBlock(block.id, {
      parentBlockId: sibling.id,
      afterId: children[children.length - 1]?.id,
    });
  }

  async function outdent(block) {
    if (!block.parent_block_id) return;
    const parent = blockById(block.parent_block_id);
    focusAfterRender = { blockId: block.id, atEnd: true };
    await moveBlock(block.id, {
      parentBlockId: parent?.parent_block_id || null,
      afterId: parent?.id,
    });
  }

  async function duplicateBlock(block) {
    try {
      const { block: copy } = await api.blocks.duplicate(block.id);
      upsertBlock(copy);
      focusAfterRender = { blockId: copy.id, atEnd: true };
      render();
    } catch {
      toast("Não foi possível duplicar o bloco.", { tone: "danger" });
    }
  }

  root.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    const host = elementFor(event.target);

    if (action === "seed-first-block") {
      const created = await createBlockAfter(null, { type: "paragraph" });
      focusBlock(created.id);
      return;
    }
    if (!host) return;
    const block = blockById(host.id);
    if (!block) return;

    switch (action) {
      case "add-below": {
        const created = await createBlockAfter(block, { type: "paragraph" });
        const el = focusBlock(created.id);
        if (el) setTimeout(() => openSlash(created.id, el), 0);
        return;
      }
      case "block-menu":
        openBlockMenu(event.target, block, {
          duplicate: (b) => duplicateBlock(b),
          delete: (b) => deleteBlock(b),
          "turn-into": (b, type) => turnInto(b, type),
          "copy-link": (b) => copyBlockLink(b),
          recolor: (b, field, color) => recolor(b, field, color),
        });
        return;
      case "toggle-check": {
        const checked = event.target.checked;
        const content = { ...(block.content || {}), checked };
        upsertBlock({ ...block, content });
        event.target.closest(".ws-row")?.querySelector(".ws-text")
          ?.classList.toggle("is-checked", checked);
        markDirty(block.id, { content });
        return;
      }
      case "toggle-expand": {
        const expanded = block.content?.expanded === false;
        const content = { ...(block.content || {}), expanded };
        upsertBlock({ ...block, content });
        render();
        markDirty(block.id, { content });
        return;
      }
      case "callout-emoji": {
        // Menu de emojis em vez de caixa de texto: ninguém tem o emoji
        // decorado para digitar, e o seletor completo fica a um clique.
        openMenu({
          anchor: event.target,
          width: 220,
          items: [
            ...CALLOUT_EMOJIS.map((e) => ({ id: `emoji:${e}`, label: e, icon: e,
                                            section: "Sugestões" })),
            { separator: true },
            { id: "__more__", label: "Escolher outro…", icon: "🔎" },
          ],
          onSelect: async (id) => {
            let emoji = null;
            if (id === "__more__") {
              const picked = await openIconPicker({ hasIcon: true });
              if (!picked || picked.type !== "emoji") return;
              emoji = picked.value;
            } else {
              emoji = id.slice(6);
            }
            if (!emoji) return;
            const content = { ...(block.content || {}), emoji: emoji.slice(0, 4) };
            upsertBlock({ ...block, content });
            render();
            markDirty(block.id, { content });
          },
        });
        return;
      }
      case "pick-media":
        await promptMedia(block);
        return;
      case "open-subpage": {
        event.preventDefault();
        const pageId = event.target.dataset.pageId;
        if (pageId) {
          root.dispatchEvent(
            new CustomEvent("workspace:navigate", { bubbles: true, detail: { pageId } }),
          );
        }
        return;
      }
      default:
    }
  });

  async function recolor(block, field, color) {
    const props = { ...(block.props || {}) };
    if (color === "default") delete props[field];
    else props[field] = color;
    upsertBlock({ ...block, props });
    render();
    try {
      await api.blocks.update(block.id, { props });
    } catch {
      toast("Não foi possível aplicar a cor.", { tone: "danger" });
    }
  }

  async function copyBlockLink(block) {
    const url = `${window.location.origin}/?p=${getState().currentPageId}#b-${block.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link do bloco copiado.", { tone: "success" });
    } catch {
      // Área de transferência negada pelo navegador: entregamos o link
      // num diálogo nosso, já selecionado.
      await openCopyLink({ title: "Link do bloco", url });
    }
  }

  // Colagem sempre como texto: nada de HTML de outro site entrando no
  // documento (§64 na prática — o conteúdo colado é dado, não markup).
  root.addEventListener("workspace:database-deleted", async (event) => {
    const { databaseId } = event.detail;
    const block = getState().blocks.find(
      (b) => b.type === "database" && b.content?.databaseId === databaseId,
    );
    if (block) await deleteBlock(block, { focusPrevious: false });
  });

  root.addEventListener("paste", (event) => {
    const editableEl = event.target.closest("[data-editable]");
    if (!editableEl) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  });

  document.addEventListener("selectionchange", () => {
    if (!document.activeElement || !root.contains(document.activeElement)) {
      hideFormattingBar();
      return;
    }
    syncFormattingBar(root, () => {
      const editableEl = document.activeElement.closest("[data-editable]");
      const host = elementFor(document.activeElement);
      if (editableEl && host) commit(host.id, editableEl);
    });
  });

  root.addEventListener("focusout", () => {
    if (dirty.size) flush();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty.size) flush({ keepalive: true });
  });

  initDnd(root, {
    itemSelector: ".ws-block",
    handleSelector: ".ws-block__handle",
    allowNest: (id) => blockSpec(blockById(id)?.type || "").children,
    isDescendant: (candidateId, rootId) => {
      let cur = blockById(candidateId);
      const seen = new Set();
      while (cur?.parent_block_id && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.parent_block_id === rootId) return true;
        cur = blockById(cur.parent_block_id);
      }
      return false;
    },
    onDrop: ({ id, targetId, place }) => {
      const target = blockById(targetId);
      if (!target) return;
      if (place === "inside") {
        const children = blockChildrenOf(targetId);
        return moveBlock(id, {
          parentBlockId: targetId,
          afterId: children[children.length - 1]?.id,
        });
      }
      return moveBlock(id, {
        parentBlockId: target.parent_block_id || null,
        ...(place === "before" ? { beforeId: targetId } : { afterId: targetId }),
      });
    },
  });

  return {
    render,
    flush,
    focusBlock,
    createFirstBlock: () => createBlockAfter(null, { type: "paragraph" }),
    destroy: () => {
      clearTimeout(saveTimer);
      closeSlash();
      closeMenu();
      hideFormattingBar();
      if (dirty.size) flush();
    },
  };
}

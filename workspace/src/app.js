/**
 * Shell do Workspace: bootstrap, roteamento e ligação entre sidebar,
 * cabeçalho e editor.
 *
 * Rota: /?p=<pageId> na raiz do domínio próprio do Workspace. Path fixo
 * + query param funciona com hosting estático e permite deep link sem
 * configuração de rewrite.
 */
import { api, ApiError } from "./api.js";
import "./session.js"; // captura ?session= / ?k= da URL e limpa a barra de endereço
import {
  getState, setState, subscribe, childrenOf, pagesInSection, isFavorite,
  revealPage, upsertPageInTree, removePagesFromTree,
} from "./store.js";
import { createSidebar } from "./sidebar.js";
import { createPageHeader } from "./page-header.js";
import { createEditor } from "./editor/editor.js";
import { openModal } from "./ui/menu.js";
import { toast } from "./ui/toast.js";
import { renderIcon } from "./icon-picker.js";
import { openSectionDialog } from "./section-dialog.js";
import { createCrmView } from "./crm/crm-view.js";

const els = {
  shell: document.getElementById("ws-shell"),
  sidebar: document.getElementById("ws-sidebar-tree"),
  sidebarToggle: document.getElementById("ws-sidebar-toggle"),
  sidebarPanel: document.getElementById("ws-sidebar"),
  backdrop: document.getElementById("ws-sidebar-backdrop"),
  newPage: document.getElementById("ws-new-page"),
  saveState: document.getElementById("ws-save-state"),
  header: document.getElementById("ws-page-header"),
  editor: document.getElementById("ws-editor"),
  main: document.getElementById("ws-main"),
  favoriteBtn: document.getElementById("ws-favorite"),
  pageMenuBtn: document.getElementById("ws-page-menu"),
};

let sidebar = null;
let header = null;
let editor = null;
let titleTimer = null;

/* ------------------------------------------------------------------ */
/* Bootstrap                                                          */
/* ------------------------------------------------------------------ */

async function bootstrap() {
  // Quem decide se há acesso é o servidor: ele aceita JWT do SSO, chave de
  // admin ou o modo de tenant fixo, e o browser não tem como saber qual
  // está ativo. Tentamos o bootstrap e só mostramos a barreira num 401.
  try {
    const data = await api.bootstrap();
    setState(
      {
        ready: true,
        workspace: data.workspace,
        viewer: data.viewer,
        pages: data.pages,
        sections: data.sections || [],
        favorites: data.favorites,
        recent: data.recent,
      },
      "bootstrap",
    );

    sidebar = createSidebar(els.sidebar, sidebarHandlers);
    header = createPageHeader(els.header, headerHandlers);
    editor = createEditor(els.editor);

    sidebar.render();
    wireShell();

    const params = new URLSearchParams(window.location.search);
    const crm = params.get("crm");
    const initial = params.get("p");
    if (crm) openCrm(crm);
    else if (initial) await openPage(initial, { push: false });
    else await openInitialPage();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      renderGate(
        "Sessão necessária",
        "Abra o Workspace pelo app — o SSO entrega a sessão automaticamente. " +
          "Para acesso de suporte: ?k=SUA_CHAVE&tenantId=LOCATION_ID",
      );
      return;
    }
    renderGate(
      "Não foi possível carregar o workspace",
      err.code === "db_error"
        ? "O banco não respondeu. Confira se a migration 0002_workspace_engine.sql foi aplicada."
        : "Tente recarregar a página em alguns instantes.",
    );
  }
}

function renderGate(title, message) {
  els.shell.innerHTML = "";
  const box = document.createElement("div");
  box.className = "ws-gate";
  const h = document.createElement("h1");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = message;
  box.append(h, p);
  els.shell.appendChild(box);
}

/** Primeira visita: mostra o empty state em vez de uma tela em branco (§72). */
async function openInitialPage() {
  const roots = childrenOf(null);
  if (roots.length) {
    await openPage(roots[0].id, { push: false });
    return;
  }
  renderEmptyWorkspace();
}

function renderEmptyWorkspace() {
  setState({ currentPageId: null, page: null, blocks: [], breadcrumbs: [] }, "page");
  els.header.replaceChildren();
  els.editor.replaceChildren();
  updatePageChrome();

  const empty = document.createElement("div");
  empty.className = "ws-empty";
  const h = document.createElement("h2");
  h.textContent = "Crie sua primeira página";
  const p = document.createElement("p");
  p.textContent =
    "Organize notas, processos, documentos e dados do time em um lugar só.";
  const cta = document.createElement("button");
  cta.type = "button";
  cta.className = "ws-btn ws-btn--primary";
  cta.textContent = "Nova página";
  cta.addEventListener("click", () => createPage(null, {
    sectionId: getState().sections.find((s) => s.is_default)?.id,
  }));
  empty.append(h, p, cta);
  els.editor.appendChild(empty);
}

/* ------------------------------------------------------------------ */
/* Navegação                                                          */
/* ------------------------------------------------------------------ */

async function openPage(pageId, { push = true } = {}) {
  if (!pageId) return;
  editor?.flush();

  setState({ currentPageId: pageId, crmView: null }, "page-loading");
  renderSkeleton();

  try {
    const { page, blocks, breadcrumbs } = await api.pages.get(pageId);
    setState({ page, blocks, breadcrumbs }, "page");
    // Registro de tabela é página, mas não é item de navegação: injetá-lo
    // na árvore fazia cada linha aberta virar uma entrada na sidebar.
    if (!page.database_id) {
      upsertPageInTree(page);
      revealPage(pageId);
    }

    header.render(page, breadcrumbs);
    editor.render();
    sidebar.render();
    updatePageChrome();
    document.title = `${page.title || "Sem título"} · Spark`;

    if (push) {
      const url = new URL(window.location.href);
      url.searchParams.set("p", pageId);
      window.history.pushState({ pageId }, "", url.toString());
    }
    closeMobileSidebar();

    // Recentes são registrados fora do caminho crítico.
    api.pages.visit(pageId).catch(() => {});
  } catch (err) {
    if (err.code === "page_not_found") {
      toast("Essa página não existe mais.", { tone: "warn" });
      removePagesFromTree([pageId]);
      sidebar.render();
      await openInitialPage();
      return;
    }
    els.editor.replaceChildren(
      errorState("Não foi possível abrir a página.", "Seu conteúdo continua salvo.", () =>
        openPage(pageId, { push: false }),
      ),
    );
  }
}

function renderSkeleton() {
  els.header.replaceChildren();
  els.editor.replaceChildren();
  const skeleton = document.createElement("div");
  skeleton.className = "ws-skeleton";
  for (const width of ["45%", "85%", "70%", "90%", "60%"]) {
    const line = document.createElement("div");
    line.className = "ws-skeleton__line";
    line.style.width = width;
    skeleton.appendChild(line);
  }
  els.editor.appendChild(skeleton);
}

function errorState(title, detail, onRetry) {
  const box = document.createElement("div");
  box.className = "ws-error";
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = detail;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "ws-btn";
  retry.textContent = "Tentar de novo";
  retry.addEventListener("click", onRetry);
  box.append(h, p, retry);
  return box;
}

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  const crm = params.get("crm");
  const pageId = params.get("p");
  if (crm) openCrm(crm);
  else if (pageId) openPage(pageId, { push: false });
  else openInitialPage();
});

/* ------------------------------------------------------------------ */
/* Ações de página                                                    */
/* ------------------------------------------------------------------ */

async function createPage(parentPageId, options = {}) {
  try {
    const siblings = childrenOf(parentPageId);
    const { page } = await api.pages.create({
      parentPageId,
      sectionId: options.sectionId,
      afterId: siblings[siblings.length - 1]?.id,
    });
    upsertPageInTree(page);
    sidebar.render();
    await openPage(page.id);
    document.querySelector(".ws-page__title")?.focus();
  } catch {
    toast("Não foi possível criar a página.", { tone: "danger" });
  }
}

async function patchPage(patch) {
  const state = getState();
  if (!state.currentPageId || !Object.keys(patch).length) return;
  const previous = state.page;

  const optimistic = { ...state.page, ...patch };
  setState({ page: optimistic }, "page");
  upsertPageInTree(optimistic);
  header.render(optimistic, state.breadcrumbs);
  sidebar.render();

  try {
    const { page } = await api.pages.update(state.currentPageId, patch);
    setState({ page }, "page");
    upsertPageInTree(page);
  } catch {
    setState({ page: previous }, "page");
    upsertPageInTree(previous);
    header.render(previous, state.breadcrumbs);
    sidebar.render();
    toast("Não foi possível salvar a alteração da página.", { tone: "danger" });
  }
}

/** Título tem autosave próprio: sem re-render a cada tecla. */
function onTitleInput(title) {
  const state = getState();
  if (!state.page) return;
  state.page.title = title;
  // O breadcrumb da própria página também mostra o título: sem isto ele
  // ficava congelado no valor de quando a página foi aberta.
  const own = state.breadcrumbs?.[state.breadcrumbs.length - 1];
  if (own && own.id === state.page.id) own.title = title;
  header.updateTitle(title);
  upsertPageInTree({ ...state.page, title });
  sidebar.render();
  document.title = `${title || "Sem título"} · Spark`;
  setState({ saveState: "saving" }, "save-state");

  clearTimeout(titleTimer);
  titleTimer = setTimeout(commitTitle, 600);
}

async function commitTitle({ keepalive = false } = {}) {
  clearTimeout(titleTimer);
  const state = getState();
  if (!state.page) return;
  try {
    await api.pages.update(state.page.id, { title: state.page.title || "" }, { keepalive });
    setState({ saveState: "saved" }, "save-state");
  } catch {
    setState({ saveState: "error" }, "save-state");
  }
}

const sidebarHandlers = {
  onOpen: (pageId) => openPage(pageId),
  onCreate: (parentPageId, options) => createPage(parentPageId, options),
  onCreateSection: () => createSection(),
  onSectionAction: (action, sectionId, name) => sectionAction(action, sectionId, name),
  onMove: async (id, target) => {
    try {
      const { page } = await api.pages.move({ id, ...target });
      upsertPageInTree(page);
      sidebar.render();
      if (getState().currentPageId === id) {
        const { breadcrumbs } = await api.pages.get(id);
        setState({ breadcrumbs }, "page");
        header.render(getState().page, breadcrumbs);
      }
    } catch (err) {
      toast(
        err.code === "cannot_move_into_descendant"
          ? "Uma página não pode ser movida para dentro de si mesma."
          : "Não foi possível mover a página.",
        { tone: "danger" },
      );
    }
  },
  onPageAction: (action, page) => pageAction(action, page),
  onOpenTrash: () => openTrash(),
  onOpenCrm: (kind) => openCrm(kind),
};

/** Abre Leads ou Oportunidades: dados do GHL, organização nossa. */
function openCrm(kind) {
  editor?.flush();
  setState({ currentPageId: null, page: null, blocks: [], crmView: kind }, "page");
  els.header.replaceChildren();
  els.editor.replaceChildren();
  updatePageChrome();
  sidebar.render();

  const head = document.createElement("div");
  head.className = "ws-crm__head";
  const h = document.createElement("h1");
  h.className = "ws-page__title ws-crm__title";
  h.textContent = kind === "contacts" ? "Leads" : "Oportunidades";
  const sub = document.createElement("p");
  sub.className = "ws-muted";
  sub.textContent = "Dados ao vivo do GoHighLevel. Leitura apenas nesta fase.";
  head.append(h, sub);
  els.header.appendChild(head);

  const mount = document.createElement("div");
  els.editor.appendChild(mount);
  createCrmView(mount, { kind });

  const url = new URL(window.location.href);
  url.searchParams.delete("p");
  url.searchParams.set("crm", kind);
  window.history.pushState({ crm: kind }, "", url.toString());
  document.title = `${h.textContent} · Spark`;
  closeMobileSidebar();
}

async function createSection() {
  const input = await openSectionDialog();
  if (!input) return;
  try {
    const { section } = await api.sections.create(input);
    getState().sections.push(section);
    sidebar.render();
    toast(`Seção "${section.name}" criada.`, { tone: "success" });
  } catch {
    toast("Não foi possível criar a seção.", { tone: "danger" });
  }
}

async function sectionAction(action, sectionId, name) {
  const state = getState();

  if (action === "new-page") return createPage(null, { sectionId });

  if (action === "rename") {
    const current = state.sections.find((s) => s.id === sectionId);
    const input = await openSectionDialog({ section: current || { name } });
    if (!input) return;
    try {
      const { section } = await api.sections.update(sectionId, input);
      const i = state.sections.findIndex((s) => s.id === sectionId);
      if (i >= 0) state.sections[i] = section;
      sidebar.render();
    } catch {
      toast("Não foi possível renomear a seção.", { tone: "danger" });
    }
    return;
  }

  if (action === "move-up" || action === "move-down") {
    const ordered = state.sections;
    const i = ordered.findIndex((s) => s.id === sectionId);
    const target = action === "move-up" ? ordered[i - 1] : ordered[i + 1];
    if (!target) return;
    try {
      await api.sections.move(sectionId,
        action === "move-up" ? { beforeId: target.id } : { afterId: target.id });
      const { sections } = await api.sections.list();
      state.sections = sections;
      sidebar.render();
    } catch {
      toast("Não foi possível reordenar a seção.", { tone: "danger" });
    }
    return;
  }

  if (action === "delete") {
    const pages = pagesInSection(sectionId);
    const ok = await confirmDialog({
      title: "Excluir seção?",
      message: pages.length
        ? `As ${pages.length} página(s) desta seção vão para a seção padrão. Nada é excluído.`
        : "A seção será removida. Nenhuma página é afetada.",
      confirmLabel: "Excluir seção",
      danger: true,
    });
    if (!ok) return;
    try {
      const { movedTo } = await api.sections.remove(sectionId);
      state.sections = state.sections.filter((s) => s.id !== sectionId);
      for (const p of state.pages) if (p.section_id === sectionId) p.section_id = movedTo;
      sidebar.render();
    } catch (err) {
      toast(err.code === "cannot_delete_default_section"
        ? "A seção padrão não pode ser excluída."
        : "Não foi possível excluir a seção.", { tone: "danger" });
    }
  }
}

async function pageAction(action, page) {
  switch (action) {
    case "rename":
      await openPage(page.id);
      document.querySelector(".ws-page__title")?.focus();
      return;

    case "favorite":
      await toggleFavorite(page.id);
      return;

    case "duplicate":
      try {
        const { page: copy } = await api.pages.duplicate(page.id);
        upsertPageInTree(copy);
        sidebar.render();
        toast("Página duplicada.", { tone: "success" });
        await openPage(copy.id);
      } catch {
        toast("Não foi possível duplicar a página.", { tone: "danger" });
      }
      return;

    case "visibility": {
      const next = page.visibility === "shared" ? "private" : "shared";
      try {
        const { page: saved } = await api.pages.update(page.id, { visibility: next });
        upsertPageInTree(saved);
        if (getState().currentPageId === page.id) setState({ page: saved }, "page");
        sidebar.render();
      } catch {
        toast("Não foi possível alterar a visibilidade.", { tone: "danger" });
      }
      return;
    }

    case "copy-link": {
      const url = `${window.location.origin}/?p=${page.id}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("Link copiado.", { tone: "success" });
      } catch {
        window.prompt("Copie o link:", url);
      }
      return;
    }

    case "move-to-section": {
      const state = getState();
      const { openMenu } = await import("./ui/menu.js");
      openMenu({
        anchor: els.pageMenuBtn,
        placement: "bottom-end",
        width: 230,
        items: state.sections.map((s) => ({
          id: s.id, label: s.name, icon: page.section_id === s.id ? "✓" : " ",
          section: "Mover para",
        })),
        onSelect: async (sectionId) => {
          try {
            const { page: saved } = await api.pages.move({
              id: page.id, parentPageId: null, sectionId,
            });
            upsertPageInTree(saved);
            sidebar.render();
          } catch {
            toast("Não foi possível mover a página.", { tone: "danger" });
          }
        },
      });
      return;
    }

    case "archive":
      await archivePage(page);
      return;

    default:
  }
}

async function archivePage(page) {
  const children = childrenOf(page.id);
  const confirmed = await confirmDialog({
    title: "Mover para a lixeira?",
    message: children.length
      ? `"${page.title || "Sem título"}" e ${children.length} subpágina(s) vão para a lixeira. Nada é excluído agora — dá para restaurar.`
      : `"${page.title || "Sem título"}" vai para a lixeira. Dá para restaurar depois.`,
    confirmLabel: "Mover para a lixeira",
    danger: true,
  });
  if (!confirmed) return;

  try {
    const { ids } = await api.pages.archive(page.id);
    removePagesFromTree(ids);
    sidebar.render();
    if (ids.includes(getState().currentPageId)) await openInitialPage();
    toast("Movido para a lixeira.", { tone: "success" });
  } catch {
    toast("Não foi possível mover para a lixeira.", { tone: "danger" });
  }
}

async function toggleFavorite(pageId) {
  const next = !isFavorite(pageId);
  const state = getState();
  state.favorites = next
    ? [...state.favorites, { target_type: "page", target_id: pageId, position: "zz" }]
    : state.favorites.filter((f) => f.target_id !== pageId);
  sidebar.render();
  updatePageChrome();

  try {
    await api.pages.favorite(pageId, next);
  } catch {
    toast("Não foi possível atualizar os favoritos.", { tone: "danger" });
  }
}

async function openTrash() {
  let rows = [];
  try {
    const data = await api.pages.trash();
    rows = data.pages;
  } catch {
    toast("Não foi possível abrir a lixeira.", { tone: "danger" });
    return;
  }

  await openModal({
    title: "Lixeira",
    width: 560,
    render: (body) => {
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "ws-muted";
        empty.textContent = "A lixeira está vazia.";
        body.appendChild(empty);
        return;
      }
      const list = document.createElement("div");
      list.className = "ws-trash";

      for (const row of rows) {
        const item = document.createElement("div");
        item.className = "ws-trash__row";

        const label = document.createElement("span");
        label.className = "ws-trash__title";
        label.appendChild(renderIcon(row.icon_type, row.icon_value, { size: 15 }));
        const text = document.createElement("span");
        text.textContent = row.title || "Sem título";
        label.appendChild(text);

        const restore = document.createElement("button");
        restore.type = "button";
        restore.className = "ws-btn ws-btn--sm";
        restore.textContent = "Restaurar";
        restore.addEventListener("click", async () => {
          try {
            await api.pages.restore(row.id);
            upsertPageInTree({ ...row, is_archived: false });
            sidebar.render();
            item.remove();
            toast("Página restaurada.", { tone: "success" });
          } catch {
            toast("Não foi possível restaurar.", { tone: "danger" });
          }
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ws-btn ws-btn--sm ws-btn--danger";
        remove.textContent = "Excluir";
        remove.addEventListener("click", async () => {
          const ok = await confirmDialog({
            title: "Excluir definitivamente?",
            message: "A página e todo o conteúdo dela são apagados. Não dá para desfazer.",
            confirmLabel: "Excluir",
            danger: true,
          });
          if (!ok) return;
          try {
            await api.pages.remove(row.id);
            removePagesFromTree([row.id]);
            item.remove();
          } catch (err) {
            toast(
              err.status === 403
                ? "Só um admin pode excluir definitivamente."
                : "Não foi possível excluir.",
              { tone: "danger" },
            );
          }
        });

        item.append(label, restore, remove);
        list.appendChild(item);
      }
      body.appendChild(list);
    },
  });
}

function confirmDialog({ title, message, confirmLabel, danger }) {
  return openModal({
    title,
    width: 420,
    render: (body, close) => {
      const p = document.createElement("p");
      p.className = "ws-confirm__text";
      p.textContent = message;

      const actions = document.createElement("div");
      actions.className = "ws-modal__footer";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ws-btn ws-btn--ghost";
      cancel.textContent = "Cancelar";
      cancel.addEventListener("click", () => close(false));

      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = `ws-btn ${danger ? "ws-btn--danger" : "ws-btn--primary"}`;
      confirm.textContent = confirmLabel;
      confirm.addEventListener("click", () => close(true));

      actions.append(cancel, confirm);
      body.append(p, actions);
    },
  }).then((value) => value === true);
}

const headerHandlers = {
  onPatch: (patch) => patchPage(patch),
  onNavigate: (pageId) => openPage(pageId),
  onTitleInput,
  onTitleCommit: commitTitle,
};

/* ------------------------------------------------------------------ */
/* Chrome (topbar, sidebar mobile, indicador de save)                 */
/* ------------------------------------------------------------------ */

function updatePageChrome() {
  const state = getState();
  const hasPage = !!state.page;

  els.favoriteBtn.hidden = !hasPage;
  els.pageMenuBtn.hidden = !hasPage;
  if (!hasPage) return;

  const favorited = isFavorite(state.page.id);
  els.favoriteBtn.textContent = favorited ? "★" : "☆";
  els.favoriteBtn.setAttribute(
    "aria-label",
    favorited ? "Remover dos favoritos" : "Adicionar aos favoritos",
  );
  els.favoriteBtn.setAttribute("aria-pressed", favorited ? "true" : "false");
}

const SAVE_LABEL = { saved: "Salvo", saving: "Salvando…", error: "Sem salvar" };

subscribe((state, reason) => {
  if (reason === "save-state" || reason === "page") {
    els.saveState.textContent = SAVE_LABEL[state.saveState] || "";
    els.saveState.dataset.state = state.saveState;
  }
});

function wireShell() {
  els.newPage.addEventListener("click", () => createPage(null, {
    sectionId: getState().sections.find((s) => s.is_default)?.id,
  }));

  els.favoriteBtn.addEventListener("click", () => {
    const state = getState();
    if (state.page) toggleFavorite(state.page.id);
  });

  els.pageMenuBtn.addEventListener("click", () => {
    const state = getState();
    if (state.page) openPageMenuFor(state.page);
  });

  els.sidebarToggle.addEventListener("click", () => {
    els.sidebarPanel.classList.toggle("is-open");
    els.backdrop.hidden = !els.sidebarPanel.classList.contains("is-open");
  });
  els.backdrop.addEventListener("click", closeMobileSidebar);

  // Navegação disparada de dentro do editor (link de subpágina).
  els.editor.addEventListener("workspace:navigate", (event) => {
    openPage(event.detail.pageId);
  });
  els.editor.addEventListener("workspace:page-created", (event) => {
    upsertPageInTree(event.detail.page);
    sidebar.render();
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      // O editor não tem botão Salvar (§36): Ctrl+S apenas força o flush.
      event.preventDefault();
      editor?.flush();
      commitTitle();
    }
  });

  // keepalive: sem isso o navegador cancela o último salvamento ao fechar.
  window.addEventListener("beforeunload", () => {
    editor?.flush({ keepalive: true });
    commitTitle({ keepalive: true });
  });
}

function openPageMenuFor(page) {
  import("./ui/menu.js").then(({ openMenu }) => {
    const favorited = isFavorite(page.id);
    openMenu({
      anchor: els.pageMenuBtn,
      placement: "bottom-end",
      width: 230,
      items: [
        { id: "favorite", label: favorited ? "Remover dos favoritos" : "Adicionar aos favoritos", icon: "★" },
        { id: "duplicate", label: "Duplicar", icon: "⧉" },
        { id: "visibility", label: page.visibility === "shared" ? "Tornar privada" : "Compartilhar com o time", icon: "👥" },
        { separator: true },
        { id: "copy-link", label: "Copiar link", icon: "🔗" },
        { separator: true },
        { id: "archive", label: "Mover para a lixeira", icon: "🗑", danger: true },
      ],
      onSelect: (id) => pageAction(id, page),
    });
  });
}

function closeMobileSidebar() {
  els.sidebarPanel.classList.remove("is-open");
  els.backdrop.hidden = true;
}

bootstrap();

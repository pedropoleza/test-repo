/**
 * Store mínimo: estado + assinantes. Sem framework — o produto atual é
 * vanilla ES modules, então o módulo segue a mesma stack (§4: não trocar
 * tecnologia sem necessidade).
 *
 * A árvore de páginas vive aqui inteira (é leve: título, ícone, pai,
 * posição). O conteúdo de página é carregado sob demanda (§75).
 */

const state = {
  ready: false,
  workspace: null,
  viewer: null,
  pages: [],          // árvore achatada
  sections: [],       // seções da sidebar
  favorites: [],
  recent: [],
  currentPageId: null,
  crmView: null,      // 'contacts' | 'opportunities' | 'tasks' | null
  crmLists: [],       // recortes salvos de pipeline/estágio
  crmListId: null,    // lista aberta, quando houver
  page: null,         // página aberta (completa)
  blocks: [],
  breadcrumbs: [],
  expanded: new Set(),
  saveState: "saved", // saved | saving | error
  error: null,
};

const listeners = new Set();
const EXPANDED_KEY = "workspace:expanded";
const COLLAPSED_SECTIONS_KEY = "workspace:collapsedSections";

/** Seções recolhidas. Preferência de quem olha, então vive no browser. */
const collapsedSections = new Set();
try {
  const raw = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
  if (raw) JSON.parse(raw).forEach((id) => collapsedSections.add(id));
} catch { /* noop */ }

try {
  const raw = localStorage.getItem(EXPANDED_KEY);
  if (raw) JSON.parse(raw).forEach((id) => state.expanded.add(id));
} catch {
  /* noop */
}

function persistExpanded() {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...state.expanded]));
  } catch {
    /* noop */
  }
}

export function getState() {
  return state;
}

export function isSectionCollapsed(sectionId) {
  return collapsedSections.has(sectionId);
}

/** Recolhe ou expande todas as seções de uma vez. */
export function setAllSectionsCollapsed(collapsed) {
  collapsedSections.clear();
  if (collapsed) for (const s of state.sections) collapsedSections.add(s.id);
  try {
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...collapsedSections]));
  } catch { /* noop */ }
  emit("tree");
}

/**
 * Recolhe uma seção UMA vez, na primeira vez que ela é vista.
 *
 * A seção de fichas cresce sem teto — uma por contato aberto — e aberta
 * por padrão empurra o resto da navegação para fora da tela. Recolher só
 * na primeira vez respeita quem depois decidir deixá-la aberta.
 */
const SEEDED_KEY = "workspace:sectionsSeeded";
export function collapseSectionOnce(sectionId) {
  if (!sectionId) return;
  let seeded = [];
  try { seeded = JSON.parse(localStorage.getItem(SEEDED_KEY) || "[]"); } catch { /* noop */ }
  if (seeded.includes(sectionId)) return;

  collapsedSections.add(sectionId);
  seeded.push(sectionId);
  try {
    localStorage.setItem(SEEDED_KEY, JSON.stringify(seeded));
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...collapsedSections]));
  } catch { /* noop */ }
}

export function toggleSectionCollapsed(sectionId, force) {
  const next = force === undefined ? !collapsedSections.has(sectionId) : force;
  if (next) collapsedSections.add(sectionId);
  else collapsedSections.delete(sectionId);
  try {
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...collapsedSections]));
  } catch { /* noop */ }
  emit("tree");
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(reason = "update") {
  for (const fn of listeners) fn(state, reason);
}

export function setState(patch, reason) {
  Object.assign(state, patch);
  emit(reason);
}

/* ---------------- helpers de árvore ---------------- */

export function childrenOf(parentId) {
  return state.pages
    .filter((p) => (p.parent_page_id || null) === (parentId || null) && !p.is_archived)
    .sort((a, b) => (a.position < b.position ? -1 : 1));
}

/** Páginas de raiz de uma seção. Sem seção definida caem na padrão. */
export function pagesInSection(sectionId) {
  const fallback = state.sections.find((s) => s.is_default)?.id || null;
  return childrenOf(null).filter(
    (p) => (p.section_id || fallback) === sectionId,
  );
}

export function pageById(id) {
  return state.pages.find((p) => p.id === id) || null;
}

export function isFavorite(id) {
  return state.favorites.some((f) => f.target_id === id);
}

export function isExpanded(id) {
  return state.expanded.has(id);
}

export function toggleExpanded(id, force) {
  const next = force === undefined ? !state.expanded.has(id) : force;
  if (next) state.expanded.add(id);
  else state.expanded.delete(id);
  persistExpanded();
  emit("tree");
}

/** Marca os ancestrais como abertos para revelar a página atual. */
export function revealPage(id) {
  let cursor = pageById(id);
  const guard = new Set();
  while (cursor?.parent_page_id && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    state.expanded.add(cursor.parent_page_id);
    cursor = pageById(cursor.parent_page_id);
  }
  persistExpanded();
}

/** Aplica uma atualização de página na árvore sem refazer o bootstrap. */
export function upsertPageInTree(page) {
  const idx = state.pages.findIndex((p) => p.id === page.id);
  const summary = {
    id: page.id,
    parent_page_id: page.parent_page_id ?? null,
    title: page.title ?? "",
    icon_type: page.icon_type ?? null,
    icon_value: page.icon_value ?? null,
    visibility: page.visibility ?? "private",
    position: page.position ?? "V",
    section_id: page.section_id ?? null,
    is_archived: page.is_archived ?? false,
    updated_at: page.updated_at ?? new Date().toISOString(),
    source: page.source ?? "native",
  };
  if (idx >= 0) state.pages[idx] = { ...state.pages[idx], ...summary };
  else state.pages.push(summary);
}

export function removePagesFromTree(ids) {
  const set = new Set(ids);
  state.pages = state.pages.filter((p) => !set.has(p.id));
}

/* ---------------- helpers de blocos ---------------- */

export function blockChildrenOf(parentBlockId) {
  return state.blocks
    .filter((b) => (b.parent_block_id || null) === (parentBlockId || null))
    .sort((a, b) => (a.position < b.position ? -1 : 1));
}

export function blockById(id) {
  return state.blocks.find((b) => b.id === id) || null;
}

export function upsertBlock(block) {
  const idx = state.blocks.findIndex((b) => b.id === block.id);
  if (idx >= 0) state.blocks[idx] = { ...state.blocks[idx], ...block };
  else state.blocks.push(block);
}

export function removeBlock(id) {
  state.blocks = state.blocks.filter((b) => b.id !== id && b.parent_block_id !== id);
}

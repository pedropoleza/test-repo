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
  favorites: [],
  recent: [],
  currentPageId: null,
  page: null,         // página aberta (completa)
  blocks: [],
  breadcrumbs: [],
  expanded: new Set(),
  saveState: "saved", // saved | saving | error
  error: null,
};

const listeners = new Set();
const EXPANDED_KEY = "workspace:expanded";

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

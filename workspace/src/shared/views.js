/**
 * Views salvas de uma lista/aba do CRM.
 *
 * No Notion, um banco tem várias "views" — cada uma com seu filtro,
 * ordenação, colunas e formato (tabela ou quadro) — e troca-se num clique.
 * Aqui é o mesmo: em vez de um único conjunto de preferências por
 * lista, guarda-se uma coleção de views nomeadas e qual está ativa.
 *
 * Puro e testável: os reducers recebem o estado `{ activeId, views }` e
 * devolvem um novo. Quem persiste no localStorage é a tela.
 */

/** As preferências padrão de uma view nova. */
export function prefsPadrao() {
  return {
    visible: null,
    sorts: [],
    filters: { op: "and", conditions: [] },
    groupBy: null,
    search: "",
    viewMode: "table",
    boardPipeline: null,
  };
}

/** Garante que um objeto de prefs tem os campos esperados. */
export function normalizarPrefs(prefs = {}) {
  const base = prefsPadrao();
  const out = { ...base, ...prefs };
  if (!out.filters?.conditions) out.filters = { op: "and", conditions: [] };
  return out;
}

let contador = 0;
/** Um id de view. Único o bastante para uso local; injetável nos testes. */
export function novoId() {
  contador += 1;
  return `v${Date.now().toString(36)}${contador}`;
}

/**
 * O estado inicial de views para uma lista.
 *
 * Se já havia preferências (do modelo antigo, de uma só view), elas viram
 * a primeira view "Padrão" — ninguém perde o filtro que tinha montado.
 * Sem nada, nasce uma view padrão vazia.
 */
export function estadoInicial(prefsLegado = null, id = novoId()) {
  const prefs = normalizarPrefs(prefsLegado || {});
  const view = { id, name: "Padrão", prefs };
  return { activeId: id, views: [view] };
}

/** Sanitiza um estado vindo do storage (pode estar velho ou corrompido). */
export function normalizarEstado(bruto, prefsLegado = null) {
  if (!bruto || !Array.isArray(bruto.views) || !bruto.views.length) {
    return estadoInicial(prefsLegado);
  }
  const views = bruto.views
    .filter((v) => v && v.id)
    .map((v) => ({ id: v.id, name: v.name || "Sem nome", prefs: normalizarPrefs(v.prefs) }));
  if (!views.length) return estadoInicial(prefsLegado);
  const activeId = views.some((v) => v.id === bruto.activeId) ? bruto.activeId : views[0].id;
  return { activeId, views };
}

/** A view ativa. */
export function viewAtiva(state) {
  return state.views.find((v) => v.id === state.activeId) || state.views[0];
}

/**
 * Adiciona uma view, clonando as prefs de base (por padrão as da ativa,
 * para a nova começar do que se está vendo) e já a torna ativa.
 */
export function adicionar(state, { name = "Nova visão", base = null, id = novoId() } = {}) {
  const prefsBase = base || viewAtiva(state)?.prefs || prefsPadrao();
  const view = { id, name, prefs: normalizarPrefs(JSON.parse(JSON.stringify(prefsBase))) };
  return { activeId: id, views: [...state.views, view] };
}

/** Renomeia uma view. */
export function renomear(state, id, name) {
  return {
    ...state,
    views: state.views.map((v) => (v.id === id ? { ...v, name: name || v.name } : v)),
  };
}

/** Remove uma view. Nunca remove a última; escolhe outra ativa se preciso. */
export function remover(state, id) {
  if (state.views.length <= 1) return state;
  const views = state.views.filter((v) => v.id !== id);
  const activeId = state.activeId === id ? views[0].id : state.activeId;
  return { activeId, views };
}

/** Troca a view ativa. */
export function trocar(state, id) {
  if (!state.views.some((v) => v.id === id)) return state;
  return { ...state, activeId: id };
}

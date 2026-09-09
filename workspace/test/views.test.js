/**
 * Views salvas de uma lista do CRM.
 *
 * Migrar sem perder o que já existia; nunca remover a última; e a nova
 * view nasce do que se está vendo (clona a ativa), não zerada.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  prefsPadrao, normalizarPrefs, estadoInicial, normalizarEstado,
  viewAtiva, adicionar, renomear, remover, trocar,
} from "../src/shared/views.js";

test("normalizarPrefs completa os campos que faltam", () => {
  const p = normalizarPrefs({ search: "x" });
  assert.equal(p.search, "x");
  assert.equal(p.viewMode, "table");
  assert.deepEqual(p.filters, { op: "and", conditions: [] });
});

test("estado inicial migra prefs antigas para a primeira view", () => {
  const st = estadoInicial({ groupBy: "stage", viewMode: "board" }, "v1");
  assert.equal(st.views.length, 1);
  assert.equal(st.views[0].name, "Padrão");
  assert.equal(st.views[0].prefs.groupBy, "stage");
  assert.equal(st.views[0].prefs.viewMode, "board");
  assert.equal(st.activeId, "v1");
});

test("normalizarEstado cria padrão quando não há nada", () => {
  const st = normalizarEstado(null, null);
  assert.equal(st.views.length, 1);
  assert.equal(viewAtiva(st).name, "Padrão");
});

test("normalizarEstado conserta activeId inválido", () => {
  const st = normalizarEstado({ activeId: "sumiu", views: [{ id: "a", name: "A", prefs: {} }] });
  assert.equal(st.activeId, "a");
});

test("adicionar clona as prefs da ativa e ativa a nova", () => {
  let st = estadoInicial({ groupBy: "stage" }, "v1");
  st = adicionar(st, { name: "Só ganhos", id: "v2" });
  assert.equal(st.views.length, 2);
  assert.equal(st.activeId, "v2");
  // Clonou o groupBy da ativa…
  assert.equal(viewAtiva(st).prefs.groupBy, "stage");
  // …mas é cópia: mexer numa não afeta a outra.
  viewAtiva(st).prefs.groupBy = "pipeline";
  assert.equal(st.views[0].prefs.groupBy, "stage");
});

test("renomear troca só o nome da view certa", () => {
  let st = estadoInicial(null, "v1");
  st = adicionar(st, { name: "B", id: "v2" });
  st = renomear(st, "v1", "Principal");
  assert.equal(st.views.find((v) => v.id === "v1").name, "Principal");
  assert.equal(st.views.find((v) => v.id === "v2").name, "B");
});

test("remover nunca tira a última", () => {
  let st = estadoInicial(null, "v1");
  st = remover(st, "v1");
  assert.equal(st.views.length, 1);
});

test("remover a ativa escolhe outra", () => {
  let st = estadoInicial(null, "v1");
  st = adicionar(st, { name: "B", id: "v2" });   // ativa vira v2
  st = remover(st, "v2");
  assert.equal(st.views.length, 1);
  assert.equal(st.activeId, "v1");
});

test("trocar ignora id inexistente", () => {
  let st = estadoInicial(null, "v1");
  st = trocar(st, "nope");
  assert.equal(st.activeId, "v1");
});

test("prefsPadrao é sempre um objeto novo", () => {
  assert.notEqual(prefsPadrao(), prefsPadrao());
  assert.notEqual(prefsPadrao().filters, prefsPadrao().filters);
});

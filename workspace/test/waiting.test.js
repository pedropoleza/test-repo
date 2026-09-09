/**
 * Painel operacional "Aguardando".
 *
 * O que precisa valer: só entram casos realmente parados numa espera, e
 * o mais parado vem primeiro — é a ordem em que ela deve agir. Um funil
 * de outro negócio (sem estágios de espera) não vira painel.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { esperaDoEstagio, organizarAguardando, ESPERAS } from "../src/shared/waiting.js";

const HOJE = new Date("2026-09-09T12:00:00Z");

function caso(nome, stage, diasAtras) {
  return {
    externalId: nome, title: nome, properties: { stage },
    lastStageChangeAt: new Date(HOJE.getTime() - diasAtras * 86400000).toISOString(),
  };
}

/* ---------------- classificar o estágio ---------------- */

test("reconhece as esperas dos estágios reais", () => {
  assert.equal(esperaDoEstagio("Waiting Documents").tipo, "cliente");
  assert.equal(esperaDoEstagio("Waiting Third Party").tipo, "terceiro");
  assert.equal(esperaDoEstagio("Ready for Delivery").tipo, "cliente");
});

test("estágio que não é espera devolve null", () => {
  for (const s of ["New Request", "Triage / Quote", "In Process", "Delivered / Paid", "", null]) {
    assert.equal(esperaDoEstagio(s), null, `"${s}" virou espera`);
  }
});

/* ---------------- organizar ---------------- */

test("agrupa por tipo de espera, na ordem de atenção", () => {
  const { grupos, total } = organizarAguardando([
    caso("A", "Waiting Third Party", 5),
    caso("B", "Waiting Documents", 3),
    caso("C", "Ready for Delivery", 1),
    caso("D", "In Process", 10),          // não é espera
  ], { agora: HOJE });

  assert.equal(total, 3, "In Process não conta");
  assert.deepEqual(grupos.map((g) => g.id), ["documentos", "retirada", "terceiro"]);
});

test("dentro da faixa, o mais parado vem primeiro", () => {
  const { grupos } = organizarAguardando([
    caso("recente", "Waiting Documents", 2),
    caso("antigo", "Waiting Documents", 40),
    caso("meio", "Waiting Documents", 15),
  ], { agora: HOJE });
  assert.deepEqual(grupos[0].itens.map((i) => i.record.title), ["antigo", "meio", "recente"]);
});

test("cada item leva o registro, a espera e os dias", () => {
  const { grupos } = organizarAguardando([caso("X", "Waiting Documents", 7)], { agora: HOJE });
  const item = grupos[0].itens[0];
  assert.equal(item.record.title, "X");
  assert.equal(item.espera.tipo, "cliente");
  assert.equal(item.dias, 7);
});

test("dias já calculado pelo servidor tem precedência", () => {
  const r = caso("Y", "Waiting Third Party", 1);
  r.diasParado = 99;
  const { grupos } = organizarAguardando([r], { agora: HOJE });
  assert.equal(grupos[0].itens[0].dias, 99);
});

test("funil de outro negócio não vira painel", () => {
  const { grupos, total } = organizarAguardando([
    caso("A", "Novo Lead", 5), caso("B", "Proposta", 3), caso("C", "January", 2),
  ], { agora: HOJE });
  assert.equal(total, 0);
  assert.deepEqual(grupos, []);
});

test("lista vazia não quebra", () => {
  assert.deepEqual(organizarAguardando([], { agora: HOJE }), { grupos: [], total: 0 });
  assert.deepEqual(organizarAguardando(), { grupos: [], total: 0 });
});

test("toda espera produzida existe na tabela", () => {
  const ids = new Set(ESPERAS.map((e) => e.id));
  for (const s of ["Waiting Documents", "Waiting Third Party", "Ready for Delivery"]) {
    assert.ok(ids.has(esperaDoEstagio(s).id));
  }
});

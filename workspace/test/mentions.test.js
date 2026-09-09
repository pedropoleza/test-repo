/**
 * @menções em texto livre.
 *
 * O que fica destacado na tela tem que ser exatamente o que se guarda
 * como menção — por isso `segmentar` e `mencoesEm` compartilham a regra.
 * E o casamento respeita o nome mais longo e a fronteira de palavra, para
 * "@Ana" não cortar "@Ana Paula" nem casar dentro de "@Anabela".
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  segmentar, mencoesEm, mencaoEmDigitacao, sugerir,
} from "../src/shared/mentions.js";

const EQUIPE = [
  { id: "u1", name: "Samantha" },
  { id: "u2", name: "Ana Paula" },
  { id: "u3", name: "Ana" },
];
const NOMES = EQUIPE.map((u) => u.name);

/* ---------------- segmentar ---------------- */

test("separa texto de menção", () => {
  const segs = segmentar("oi @Samantha confere", NOMES);
  assert.deepEqual(segs, [
    { tipo: "texto", valor: "oi " },
    { tipo: "mencao", valor: "Samantha" },
    { tipo: "texto", valor: " confere" },
  ]);
});

test("prefere o nome mais longo", () => {
  const segs = segmentar("@Ana Paula veja", NOMES);
  assert.equal(segs[0].tipo, "mencao");
  assert.equal(segs[0].valor, "Ana Paula");
});

test("não casa dentro de uma palavra maior", () => {
  // "@Anabela" não é a Ana: a fronteira depois do nome barra o casamento.
  const segs = segmentar("fala com @Anabela", NOMES);
  assert.ok(segs.every((s) => s.tipo === "texto"));
});

test("sem usuários, é tudo texto", () => {
  const segs = segmentar("oi @Samantha", []);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].tipo, "texto");
});

/* ---------------- mencoesEm ---------------- */

test("resolve os usuários citados, sem repetir", () => {
  const citados = mencoesEm("@Samantha e @Ana e de novo @Samantha", EQUIPE);
  assert.deepEqual(citados.map((u) => u.id), ["u1", "u3"]);
});

test("menção a nome que não é da equipe não conta", () => {
  assert.deepEqual(mencoesEm("@Fulano oi", EQUIPE), []);
});

/* ---------------- autocomplete ---------------- */

test("detecta a menção em digitação e onde começa", () => {
  const texto = "oi @Sam";
  const m = mencaoEmDigitacao(texto, texto.length);
  assert.equal(m.termo, "Sam");
  assert.equal(m.inicio, 3);
});

test("espaço fecha a digitação da menção", () => {
  assert.equal(mencaoEmDigitacao("oi @Sam ", "oi @Sam ".length), null);
});

test("@ no meio de palavra (email) não abre menção", () => {
  assert.equal(mencaoEmDigitacao("email a@b", "email a@b".length), null);
});

test("sugerir filtra por trecho e limita", () => {
  assert.deepEqual(sugerir("ana", EQUIPE).map((u) => u.id), ["u2", "u3"]);
  assert.equal(sugerir("", EQUIPE, 2).length, 2);
});

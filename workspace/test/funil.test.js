/**
 * O molde de um funil novo.
 *
 * O que precisa valer:
 *
 * 1. As etapas chegam de um copiar-colar, não de um formulário: com
 *    numeração, setas ou vírgulas. Todas as formas têm que virar lista.
 * 2. Nenhum funil nasce sem coluna — um quadro vazio não abre.
 * 3. Dois nomes iguais não podem colidir id, senão as duas colunas
 *    juntam os cards em silêncio.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  lerEtapas, montarFunil, nomeDoCampoDeEtapas, idDeEtapa,
  ETAPAS_SUGERIDAS, CAMPOS_BASE,
} from "../src/shared/funil.js";

/* ---------------- ler as etapas ---------------- */

test("uma etapa por linha", () => {
  assert.deepEqual(lerEtapas("Novo\nEm contato\nFechou"), ["Novo", "Em contato", "Fechou"]);
});

test("aceita o funil colado de uma mensagem", () => {
  // É assim que um funil chega: "NOVO LEAD → TENTATIVA → QUALIFICADO".
  assert.deepEqual(lerEtapas("NOVO LEAD → TENTATIVA DE CONTATO → QUALIFICADO"),
    ["NOVO LEAD", "TENTATIVA DE CONTATO", "QUALIFICADO"]);
  assert.deepEqual(lerEtapas("1. Novo\n2. Em contato\n3. Fechou"),
    ["Novo", "Em contato", "Fechou"]);
  assert.deepEqual(lerEtapas("- Novo\n• Em contato"), ["Novo", "Em contato"]);
});

test("vírgula separa, mas barra não", () => {
  // "No show / Reagendar" é UMA etapa; separar na barra a partiria em
  // duas colunas que ninguém pediu.
  assert.deepEqual(lerEtapas("Novo, Em contato"), ["Novo", "Em contato"]);
  assert.deepEqual(lerEtapas("No show / Reagendar"), ["No show / Reagendar"]);
});

test("linha vazia e etapa repetida não viram coluna", () => {
  assert.deepEqual(lerEtapas("Novo\n\n  \nNovo\nNOVO\nFechou"), ["Novo", "Fechou"]);
  assert.deepEqual(lerEtapas(""), []);
  assert.deepEqual(lerEtapas(), []);
});

/* ---------------- montar o funil ---------------- */

test("sem etapas escritas, nasce com as sugeridas", () => {
  // Um quadro sem coluna nenhuma não abre, e deixar a pessoa diante de
  // uma tela vazia é o oposto do que este atalho existe para fazer.
  const f = montarFunil({ nome: "Parcerias" });
  assert.deepEqual(f.campoDeEtapas.config.options.map((o) => o.name), ETAPAS_SUGERIDAS);
  assert.equal(f.titulo, "Parcerias");
  assert.equal(f.campoDeEtapas.name, "Etapas", "dentro do funil, o nome dele seria redundante");
});

test("as etapas escritas vencem as sugeridas, na ordem", () => {
  const f = montarFunil({ nome: "SDR", etapas: lerEtapas("Novo lead\nQualificado\nCloser") });
  assert.deepEqual(f.campoDeEtapas.config.options.map((o) => o.name),
    ["Novo lead", "Qualificado", "Closer"]);
  assert.ok(f.campoDeEtapas.config.options.every((o) => o.color), "toda coluna tem cor");
});

test("etapas com nomes parecidos não colidem id", () => {
  const ids = montarFunil({ nome: "x", etapas: ["Reunião", "Reuniao", "reunião"] })
    .campoDeEtapas.config.options.map((o) => o.id);
  assert.equal(new Set(ids).size, 3, `ids colidiram: ${ids}`);
});

test("funil sem nome ainda abre", () => {
  const f = montarFunil({});
  assert.equal(f.titulo, "Novo funil");
  assert.equal(nomeDoCampoDeEtapas(), "Etapas");
  assert.ok(f.campoDeEtapas.config.options.length);
});

test("a ficha nasce com o suficiente para ligar para alguém", () => {
  const f = montarFunil({ nome: "x" });
  const nomes = f.campos.map((c) => c.name);
  for (const esperado of ["Telefone", "E-mail", "Próxima ação", "Notas"]) {
    assert.ok(nomes.includes(esperado), `faltou ${esperado}`);
  }
  const origem = f.campos.find((c) => c.name === "Origem do lead");
  assert.equal(origem.type, "select");
  assert.ok(origem.config.options.length >= 3);
  assert.equal(CAMPOS_BASE.length, f.campos.length);
});

test("idDeEtapa tira acento e pontuação", () => {
  assert.equal(idDeEtapa("2ª Reunião agendada"), "2_reuniao_agendada");
  assert.equal(idDeEtapa("No show / Reagendar"), "no_show_reagendar");
});

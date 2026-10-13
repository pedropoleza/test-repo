/**
 * Espelhar as oportunidades do CRM no quadro.
 *
 * O que precisa valer:
 *
 * 1. O estágio do CRM cai na coluna certa do quadro, mesmo com o
 *    prefixo de ordenação que as contas usam ("2- Qualificado").
 * 2. Estágio que não casa NÃO é chutado numa coluna: vira card sem
 *    etapa, visível, porque um lead na coluna errada mente.
 * 3. Importar duas vezes não duplica.
 * 4. O telefone vem do contato, não da oportunidade — um card sem
 *    telefone não serve para ligar.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizarEtapa, casarEtapa, campoPorNome, mapearOportunidades,
  resumoPorPipeline, rotuloDoStatus,
} from "../src/shared/crm-mirror.js";

const ETAPAS = [
  { id: "novo_lead", name: "Novo lead" },
  { id: "tentativa_contato", name: "Tentativa de contato" },
  { id: "qualificado", name: "Qualificado" },
  { id: "reuniao_agendada", name: "Reunião agendada" },
  { id: "no_show", name: "No show / Reagendar" },
  { id: "compareceu", name: "Compareceu" },
];
const campoEtapa = { key: "etapas_sdr", name: "Etapas SDR", type: "select", config: { options: ETAPAS } };
const CAMPOS = [
  { key: "nome", name: "Nome completo", type: "text", is_primary: true },
  campoEtapa,
  { key: "tel", name: "Telefone", type: "phone" },
  { key: "mail", name: "E-mail", type: "email" },
  { key: "uf", name: "Estado onde mora", type: "text" },
  { key: "notas", name: "Notas", type: "long_text" },
];

const opp = (id, stage, extra = {}) => ({
  externalId: id, title: `Oportunidade ${id}`, contactId: `ct_${id}`,
  properties: { stage, pipeline: "SDR Prospects", status: "open", ...extra },
});

/* ---------------- casar o estágio com a coluna ---------------- */

test("o prefixo de ordenação do CRM não atrapalha", () => {
  // As contas numeram as etapas para ordenar a lista; o número não faz
  // parte do nome. Sem tirá-lo, nada casaria.
  assert.equal(normalizarEtapa("2- Qualificado"), "qualificado");
  assert.equal(normalizarEtapa("1 · Novo Lead"), "novo lead");
  assert.equal(normalizarEtapa("03. Reunião Agendada"), "reuniao agendada");
  assert.equal(casarEtapa("2- Qualificado", ETAPAS), "qualificado");
});

test("casa por conteúdo quando o nome não é idêntico", () => {
  assert.equal(casarEtapa("No show", ETAPAS), "no_show");
  assert.equal(casarEtapa("Reunião agendada com a Dani", ETAPAS), "reuniao_agendada");
});

test("estágio que não casa vira card SEM etapa, não um chute", () => {
  // Um lead na coluna errada mente; um lead sem coluna pede atenção.
  assert.equal(casarEtapa("Underwriting", ETAPAS), null);
  assert.equal(casarEtapa("", ETAPAS), null);
  assert.equal(casarEtapa("Qualquer coisa", []), null);
});

/* ---------------- montar as fichas ---------------- */

test("cada oportunidade vira uma ficha com a etapa preenchida", () => {
  const { fichas, semEtapa } = mapearOportunidades(
    [opp("o1", "Qualificado"), opp("o2", "No show")], { campoEtapa, campos: CAMPOS });
  assert.equal(fichas.length, 2);
  assert.equal(semEtapa, 0);
  assert.equal(fichas[0].properties.etapas_sdr, "qualificado");
  assert.equal(fichas[1].properties.etapas_sdr, "no_show");
  assert.equal(fichas[0].sourceExternalId, "o1");
});

test("o telefone vem do contato, não da oportunidade", () => {
  const contatos = [{ externalId: "ct_o1", title: "Kleber Souza",
    properties: { phone: "+1 407 555 0199", email: "k@x.com", state: "FL" } }];
  const { fichas } = mapearOportunidades([opp("o1", "Qualificado")],
    { campoEtapa, campos: CAMPOS, contatos });
  assert.equal(fichas[0].title, "Kleber Souza", "o nome do contato vence o da oportunidade");
  assert.equal(fichas[0].properties.tel, "+1 407 555 0199");
  assert.equal(fichas[0].properties.mail, "k@x.com");
  assert.equal(fichas[0].properties.uf, "FL");
});

test("sem contato casado, a ficha ainda nasce com o nome da oportunidade", () => {
  const { fichas } = mapearOportunidades([opp("o1", "Qualificado")], { campoEtapa, campos: CAMPOS });
  assert.equal(fichas[0].title, "Oportunidade o1");
  assert.equal(fichas[0].properties.tel, undefined);
});

test("a ficha registra de onde veio", () => {
  // Daqui a um mês ninguém lembra o que é cópia e o que foi digitado.
  const { fichas } = mapearOportunidades([opp("o1", "Qualificado", { status: "won" })],
    { campoEtapa, campos: CAMPOS });
  assert.match(fichas[0].properties.notas, /Importado do CRM/);
  assert.match(fichas[0].properties.notas, /SDR Prospects/);
  assert.match(fichas[0].properties.notas, /Qualificado/);
  assert.match(fichas[0].properties.notas, /ganha/);
});

test("importar de novo não duplica o que já veio", () => {
  const opps = [opp("o1", "Qualificado"), opp("o2", "No show")];
  const { fichas, jaExistiam } = mapearOportunidades(opps,
    { campoEtapa, campos: CAMPOS, jaImportados: ["o1"] });
  assert.deepEqual(fichas.map((f) => f.sourceExternalId), ["o2"]);
  assert.equal(jaExistiam, 1);
});

test("estágio desconhecido entra sem etapa e é contado", () => {
  const { fichas, semEtapa } = mapearOportunidades([opp("o1", "Underwriting")],
    { campoEtapa, campos: CAMPOS });
  assert.equal(semEtapa, 1);
  assert.equal(fichas[0].properties.etapas_sdr, undefined);
  assert.equal(fichas.length, 1, "entra mesmo assim, visível em 'Sem etapa'");
});

test("oportunidade sem id é ignorada", () => {
  assert.equal(mapearOportunidades([{ title: "x" }], { campoEtapa, campos: CAMPOS }).fichas.length, 0);
  assert.deepEqual(mapearOportunidades().fichas, []);
});

/* ---------------- resumo antes de criar ---------------- */

test("o resumo conta por pipeline, da maior para a menor", () => {
  const fichas = [
    { pipeline: "SDR Prospects" }, { pipeline: "SDR Prospects" },
    { pipeline: "Policies" }, { pipeline: "" },
  ];
  assert.deepEqual(resumoPorPipeline(fichas), [
    { nome: "SDR Prospects", total: 2 },
    { nome: "Policies", total: 1 },
    { nome: "Sem pipeline", total: 1 },
  ]);
});

test("os nomes de campo são achados sem ligar para acento", () => {
  assert.equal(campoPorNome(CAMPOS, "telefone")?.key, "tel");
  assert.equal(campoPorNome(CAMPOS, "E-MAIL")?.key, "mail");
  assert.equal(campoPorNome(CAMPOS, "Inexistente"), null);
  assert.equal(rotuloDoStatus("lost"), "perdida");
});

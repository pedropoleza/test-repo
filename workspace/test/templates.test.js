/**
 * Modelos de ficha.
 *
 * O que precisa valer: aplicar um modelo ACRESCENTA. Um modelo que
 * substituísse o que já está escrito seria usado uma vez e nunca mais.
 *
 * E a pipeline apenas SUGERE: 237 dos 300 contatos desta conta não têm
 * oportunidade nenhuma. Se o modelo dependesse da pipeline, 4 de cada 5
 * fichas abririam sem roteiro.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  TEMPLATES, getTemplate, templateParaPipeline, templateParaContato, blocosDoModelo,
} from "../src/shared/templates.js";
import { isBlockType, normalizeBlockContent } from "../src/shared/blocks.js";

/* ---------------- os modelos em si ---------------- */

test("todo modelo tem id único, nome, ícone e descrição", () => {
  const ids = new Set();
  for (const t of TEMPLATES) {
    assert.ok(t.id && !ids.has(t.id), `id repetido ou vazio: ${t.id}`);
    ids.add(t.id);
    for (const campo of ["nome", "icone", "descricao"]) {
      assert.ok(t[campo], `${t.id} sem ${campo}`);
    }
  }
});

test("todo bloco de todo modelo é de um tipo que o editor conhece", () => {
  // Um tipo inventado aqui vira `unsupported` na página: o modelo
  // apareceria como uma pilha de blocos quebrados.
  for (const t of TEMPLATES) {
    for (const b of t.blocos()) {
      assert.ok(isBlockType(b.type), `${t.id}: tipo "${b.type}" não existe`);
    }
  }
});

test("o conteúdo de todo bloco sobrevive à normalização da API", () => {
  for (const t of TEMPLATES) {
    for (const b of t.blocos()) {
      assert.doesNotThrow(() => normalizeBlockContent(b.type, b.content),
        `${t.id}/${b.type} foi recusado`);
    }
  }
});

test("cada modelo traz conteúdo de verdade, não só títulos", () => {
  for (const t of TEMPLATES) {
    const blocos = t.blocos();
    assert.ok(blocos.length >= 10, `${t.id} tem só ${blocos.length} blocos`);
    assert.ok(blocos.some((b) => b.type === "checklist"),
      `${t.id} não tem nenhuma tarefa marcável`);
  }
});

test("cada chamada devolve blocos novos", () => {
  // Se o modelo devolvesse sempre o MESMO array, marcar um checklist na
  // ficha de um contato apareceria marcado na do próximo.
  const a = blocosDoModelo("apolice");
  const b = blocosDoModelo("apolice");
  assert.notEqual(a, b);
  assert.notEqual(a[0], b[0]);
  a[0].content.rich[0].s = "mexido";
  assert.notEqual(b[0].content.rich[0].s, "mexido");
});

/* ---------------- a pipeline sugere ---------------- */

test("as pipelines reais desta conta encontram um modelo", () => {
  const reais = {
    "2- Policies": "apolice",
    "3- Recruiting": "recrutamento",
    "0. old 1- Prospects leads antigos": "prospeccao",
    "0. old 1- Prospects novos leads": "prospeccao",
    "4- Agency": "agencia",
    "Aposentadoria": "consultoria",
    "Benefício em Vida": "consultoria",
    "Blindagem Patrimonial": "consultoria",
    "Carreira": "recrutamento",
  };
  for (const [pipeline, esperado] of Object.entries(reais)) {
    assert.equal(templateParaPipeline(pipeline)?.id, esperado, `pipeline "${pipeline}"`);
  }
});

test("acento e caixa não atrapalham", () => {
  assert.equal(templateParaPipeline("APÓLICES")?.id, "apolice");
  assert.equal(templateParaPipeline("apolices")?.id, "apolice");
});

test("pipeline desconhecida não recebe modelo chutado", () => {
  for (const nome of ["Financeiro", "", null, undefined, "   "]) {
    assert.equal(templateParaPipeline(nome), null, `"${nome}" recebeu modelo`);
  }
});

/* ---------------- a sugestão a partir do contato ---------------- */

test("a oportunidade mais recente decide", () => {
  const t = templateParaContato([
    { pipeline: "3- Recruiting", createdAt: "2026-01-01T00:00:00Z" },
    { pipeline: "2- Policies", createdAt: "2026-08-01T00:00:00Z" },
  ]);
  assert.equal(t.id, "apolice");
});

test("o formato do registro também serve, não só o do CRM", () => {
  const t = templateParaContato([
    { properties: { pipeline: "2- Policies", created_at: "2026-08-01" } },
  ]);
  assert.equal(t.id, "apolice");
});

test("contato sem oportunidade não recebe modelo", () => {
  // A maioria: 237 de 300. Abrir sem roteiro é melhor que abrir com o
  // roteiro errado.
  assert.equal(templateParaContato([]), null);
  assert.equal(templateParaContato(), null);
});

test("oportunidade em pipeline desconhecida cai para a próxima conhecida", () => {
  const t = templateParaContato([
    { pipeline: "Pipeline Nova", createdAt: "2026-09-01T00:00:00Z" },
    { pipeline: "2- Policies", createdAt: "2026-01-01T00:00:00Z" },
  ]);
  assert.equal(t.id, "apolice");
});

/* ---------------- busca por id ---------------- */

test("getTemplate acha pelo id e não inventa", () => {
  assert.equal(getTemplate("apolice").nome, "Apólice");
  assert.equal(getTemplate("nao_existe"), null);
  assert.deepEqual(blocosDoModelo("nao_existe"), []);
});

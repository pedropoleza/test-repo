/**
 * Vista de quadro (Kanban) das oportunidades.
 *
 * Um quadro é de uma pipeline só: as colunas são os estágios dela, na
 * ordem, e só entram os cards daquela pipeline. Card de estágio removido
 * cai em "Sem estágio" para não sumir.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  contagemPorPipeline, pipelineDoQuadro, colunasDoQuadro, totalDaColuna,
} from "../src/shared/board.js";

const PIPES = [
  { id: "p1", name: "Imigração", stages: [
    { id: "s1", name: "Novo" }, { id: "s2", name: "Em análise" }, { id: "s3", name: "Ganhou" },
  ] },
  { id: "p2", name: "Seguros", stages: [{ id: "t1", name: "Cotação" }, { id: "t2", name: "Fechado" }] },
];
const RECS = [
  { externalId: "o1", title: "A", pipelineId: "p1", stageId: "s1", properties: { value: 100 } },
  { externalId: "o2", title: "B", pipelineId: "p1", stageId: "s1", properties: { value: 50 } },
  { externalId: "o3", title: "C", pipelineId: "p1", stageId: "s3", properties: { value: 200 } },
  { externalId: "o4", title: "D", pipelineId: "p2", stageId: "t1", properties: {} },
  { externalId: "o5", title: "E", pipelineId: "p1", stageId: "removido", properties: {} },
];

test("contagem por pipeline, da maior para a menor", () => {
  const c = contagemPorPipeline(RECS, PIPES);
  assert.deepEqual(c.map((x) => [x.id, x.total]), [["p1", 4], ["p2", 1]]);
});

test("pipeline do quadro: a de mais oportunidades por padrão", () => {
  assert.equal(pipelineDoQuadro(RECS, PIPES).id, "p1");
});

test("pipeline do quadro respeita a escolha, se ainda existe", () => {
  assert.equal(pipelineDoQuadro(RECS, PIPES, "p2").id, "p2");
  // Escolha inválida cai no padrão.
  assert.equal(pipelineDoQuadro(RECS, PIPES, "xx").id, "p1");
});

test("colunas seguem a ordem dos estágios e só pegam a pipeline certa", () => {
  const cols = colunasDoQuadro(PIPES[0], RECS);
  // 3 estágios + a órfã ("Sem estágio") por causa de o5.
  assert.deepEqual(cols.map((c) => c.nome), ["Novo", "Em análise", "Ganhou", "Sem estágio"]);
  assert.deepEqual(cols[0].cards.map((r) => r.externalId), ["o1", "o2"]);
  assert.equal(cols[1].cards.length, 0);
  assert.deepEqual(cols[2].cards.map((r) => r.externalId), ["o3"]);
  assert.equal(cols[3].orfa, true);
  assert.deepEqual(cols[3].cards.map((r) => r.externalId), ["o5"]);
  // Nenhum card da p2 vazou para o quadro da p1.
  assert.ok(cols.every((c) => c.cards.every((r) => r.pipelineId === "p1")));
});

test("sem órfão, não cria a coluna Sem estágio", () => {
  const cols = colunasDoQuadro(PIPES[1], RECS);
  assert.deepEqual(cols.map((c) => c.nome), ["Cotação", "Fechado"]);
  assert.ok(!cols.some((c) => c.orfa));
});

test("total da coluna soma os valores", () => {
  const cols = colunasDoQuadro(PIPES[0], RECS);
  assert.equal(totalDaColuna(cols[0].cards), 150);
  assert.equal(totalDaColuna(cols[2].cards), 200);
});

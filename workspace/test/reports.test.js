/**
 * Relatórios por serviço.
 *
 * Faturamento é só dos ganhos; taxa de ganho é sobre o que foi decidido
 * (ganho+perdido), e fica null enquanto nada fechou; tempo médio é só dos
 * abertos. As linhas saem por faturamento.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { agregarPorServico } from "../src/shared/reports.js";

const HOJE = new Date("2026-09-09T12:00:00Z");
const PIPES = [{ id: "p1", name: "Imigração" }, { id: "p2", name: "Seguros" }];

const mk = (pid, status, value, created) => ({
  pipelineId: pid,
  properties: { status, value, pipeline: PIPES.find((p) => p.id === pid)?.name, created_at: created },
});

const RECS = [
  mk("p1", "won", 1000, "2026-08-01"),
  mk("p1", "won", 3000, "2026-08-01"),
  mk("p1", "open", 0, "2026-09-04"),   // 5 dias
  mk("p1", "lost", 500, "2026-08-01"),
  mk("p2", "open", 0, "2026-09-01"),   // 8 dias
];

test("agrega por serviço, ordenado por faturamento", () => {
  const { linhas } = agregarPorServico(RECS, PIPES, HOJE);
  assert.equal(linhas[0].nome, "Imigração");   // 4000 > 0
  assert.equal(linhas[1].nome, "Seguros");
});

test("faturamento e ticket médio só dos ganhos", () => {
  const { linhas } = agregarPorServico(RECS, PIPES, HOJE);
  const imig = linhas.find((l) => l.pipelineId === "p1");
  assert.equal(imig.faturamento, 4000);
  assert.equal(imig.ganhos, 2);
  assert.equal(imig.ticketMedio, 2000);
});

test("taxa de ganho é sobre o decidido; null quando nada fechou", () => {
  const { linhas } = agregarPorServico(RECS, PIPES, HOJE);
  const imig = linhas.find((l) => l.pipelineId === "p1");
  // 2 ganhos, 1 perdido -> 67%
  assert.equal(imig.taxaGanho, 67);
  const seg = linhas.find((l) => l.pipelineId === "p2");
  assert.equal(seg.taxaGanho, null);   // só abertos
});

test("tempo médio é só dos abertos", () => {
  const { linhas } = agregarPorServico(RECS, PIPES, HOJE);
  assert.equal(linhas.find((l) => l.pipelineId === "p1").tempoMedioAberto, 5);
  assert.equal(linhas.find((l) => l.pipelineId === "p2").tempoMedioAberto, 8);
});

test("totais somam tudo", () => {
  const { totais } = agregarPorServico(RECS, PIPES, HOJE);
  assert.equal(totais.total, 5);
  assert.equal(totais.abertos, 2);
  assert.equal(totais.ganhos, 2);
  assert.equal(totais.perdidos, 1);
  assert.equal(totais.faturamento, 4000);
  assert.equal(totais.taxaGanho, 67);
});

test("oportunidade sem pipeline cai em 'Sem pipeline'", () => {
  const { linhas } = agregarPorServico([{ pipelineId: null, properties: { status: "open" } }], [], HOJE);
  assert.equal(linhas[0].nome, "Sem pipeline");
});

test("base vazia não quebra", () => {
  const { linhas, totais } = agregarPorServico([], PIPES, HOJE);
  assert.deepEqual(linhas, []);
  assert.equal(totais.total, 0);
  assert.equal(totais.taxaGanho, null);
});

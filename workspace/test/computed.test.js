/**
 * Colunas calculadas (dias no estágio, idade).
 *
 * "Sem data" vira coluna vazia, não zero — não saber não é "hoje". E o
 * cálculo não muda o registro original.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { diasDesde, colunasCalculadas, aplicarCalculados } from "../src/shared/computed.js";

const HOJE = new Date("2026-09-09T12:00:00Z");

test("diasDesde conta dias de calendário e nunca é negativo", () => {
  assert.equal(diasDesde("2026-09-09", HOJE), 0);
  assert.equal(diasDesde("2026-09-01", HOJE), 8);
  // Data no futuro não vira número negativo.
  assert.equal(diasDesde("2026-09-20", HOJE), 0);
  assert.equal(diasDesde(null, HOJE), null);
  assert.equal(diasDesde("lixo", HOJE), null);
});

test("colunas calculadas por tipo", () => {
  assert.deepEqual(colunasCalculadas("opportunities").map((c) => c.key),
    ["calc_dias_estagio", "calc_idade"]);
  assert.deepEqual(colunasCalculadas("contacts").map((c) => c.key), ["calc_idade"]);
  assert.deepEqual(colunasCalculadas("tasks"), []);
  // Sempre só de leitura.
  assert.ok(colunasCalculadas("opportunities").every((c) => c.readOnly && c.source === "computed"));
});

test("aplica dias no estágio e idade nas oportunidades", () => {
  const recs = [
    { externalId: "o1", lastStageChangeAt: "2026-09-04", properties: { created_at: "2026-08-10" } },
  ];
  const [r] = aplicarCalculados(recs, "opportunities", HOJE);
  assert.equal(r.properties.calc_dias_estagio, 5);
  assert.equal(r.properties.calc_idade, 30);
  // Não mexeu no original.
  assert.equal(recs[0].properties.calc_dias_estagio, undefined);
});

test("registro sem data fica com coluna vazia", () => {
  const [r] = aplicarCalculados([{ externalId: "o2", properties: {} }], "opportunities", HOJE);
  assert.equal(r.properties.calc_dias_estagio, null);
  assert.equal(r.properties.calc_idade, null);
});

test("contatos só ganham idade", () => {
  const [r] = aplicarCalculados([{ externalId: "c1", properties: { created_at: "2026-09-02" } }], "contacts", HOJE);
  assert.equal(r.properties.calc_idade, 7);
  assert.equal("calc_dias_estagio" in r.properties, false);
});

test("tarefas não recebem calculadas", () => {
  const recs = [{ externalId: "t1", properties: {} }];
  assert.equal(aplicarCalculados(recs, "tasks", HOJE), recs);
});

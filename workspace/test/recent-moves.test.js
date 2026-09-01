/**
 * Movimentos recentes.
 *
 * O CRM tem duas leituras que discordam: o PUT grava e o GET por id já
 * mostra o estágio novo, mas a busca — de onde saem as listas — leva
 * mais de um minuto para enxergar. Medido nesta conta: 40s depois da
 * gravação, a busca ainda devolvia o valor antigo.
 *
 * O que precisa valer: recarregar a lista logo depois de mover NÃO pode
 * trazer o estágio antigo de volta. Ver a própria alteração se desfazer
 * é o jeito mais rápido de a pessoa parar de confiar na tela.
 */
import test from "node:test";
import assert from "node:assert/strict";

// O módulo de edição toca `document` e `localStorage` na importação de
// menu/toast; um DOM mínimo é mais barato que separar o módulo em dois.
globalThis.document = globalThis.document || {
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} },
    setAttribute() {}, append() {}, appendChild() {}, addEventListener() {},
    replaceChildren() {}, querySelector: () => null, remove() {} }),
  addEventListener() {},
  body: { appendChild() {}, contains: () => false },
};
globalThis.window = globalThis.window || { addEventListener() {}, location: { search: "" } };
const guardado = new Map();
globalThis.localStorage = globalThis.localStorage || {
  getItem: (k) => guardado.get(k) ?? null,
  setItem: (k, v) => guardado.set(k, String(v)),
  removeItem: (k) => guardado.delete(k),
};

const { aplicarMovimentosRecentes, __limparMovimentos, __lembrarMovimento } =
  await import("../src/crm/editing.js");

function registro(id, stageId, stage) {
  return { externalId: id, stageId, pipelineId: "p1", properties: { stage, pipeline: "Apólices" } };
}

test.beforeEach(() => __limparMovimentos());

test("sem nada movido, a lista passa intacta", () => {
  const rows = [registro("o1", "s-set", "September")];
  aplicarMovimentosRecentes(rows);
  assert.equal(rows[0].properties.stage, "September");
});

test("o estágio recém-gravado sobrevive a uma busca atrasada", () => {
  __lembrarMovimento("o1", {
    pipelineId: "p1", stageId: "s-nov", pipelineName: "Apólices", stageName: "November",
  });
  // A busca ainda devolve o estágio antigo — é o caso real medido.
  const rows = [registro("o1", "s-set", "September")];
  aplicarMovimentosRecentes(rows);
  assert.equal(rows[0].stageId, "s-nov");
  assert.equal(rows[0].properties.stage, "November");
  assert.equal(rows[0].properties.pipeline, "Apólices");
});

test("quando a busca alcança, o registro é esquecido", () => {
  __lembrarMovimento("o1", {
    pipelineId: "p1", stageId: "s-nov", pipelineName: "Apólices", stageName: "November",
  });
  aplicarMovimentosRecentes([registro("o1", "s-nov", "November")]);

  // Esquecido de verdade: senão, uma mudança feita por outra pessoa no
  // CRM ficaria eternamente sobrescrita pelo que nós gravamos um dia.
  const depois = [registro("o1", "s-dez", "December")];
  aplicarMovimentosRecentes(depois);
  assert.equal(depois[0].properties.stage, "December");
});

test("o movimento não vaza para outra oportunidade", () => {
  __lembrarMovimento("o1", {
    pipelineId: "p1", stageId: "s-nov", pipelineName: "Apólices", stageName: "November",
  });
  const rows = [registro("o2", "s-set", "September")];
  aplicarMovimentosRecentes(rows);
  assert.equal(rows[0].properties.stage, "September");
});

test("oportunidade que sumiu da lista não quebra a aplicação", () => {
  __lembrarMovimento("sumida", {
    pipelineId: "p1", stageId: "s-nov", pipelineName: "Apólices", stageName: "November",
  });
  assert.doesNotThrow(() => aplicarMovimentosRecentes([]));
  assert.doesNotThrow(() => aplicarMovimentosRecentes());
});

test("depois de 15 minutos, quem manda é o CRM", () => {
  // Passado o prazo, discordar da busca deixa de ser "ela está atrasada"
  // e passa a ser "alguém alterou por fora" — e aí o certo é ela.
  __lembrarMovimento("o1", {
    pipelineId: "p1", stageId: "s-nov", pipelineName: "Apólices", stageName: "November",
    em: Date.now() - 16 * 60 * 1000,
  });
  const rows = [registro("o1", "s-set", "September")];
  aplicarMovimentosRecentes(rows);
  assert.equal(rows[0].properties.stage, "September");
});

test("o movimento sobrevive a um recarregamento da página", async () => {
  __lembrarMovimento("o1", {
    pipelineId: "p1", stageId: "s-nov", pipelineName: "Apólices", stageName: "November",
  });
  // Módulo novo = página recarregada: o estado de memória some e só
  // resta o que foi persistido.
  const outro = await import(`../src/crm/editing.js?recarga=${Date.now()}`);
  const rows = [registro("o1", "s-set", "September")];
  outro.aplicarMovimentosRecentes(rows);
  assert.equal(rows[0].properties.stage, "November");
});

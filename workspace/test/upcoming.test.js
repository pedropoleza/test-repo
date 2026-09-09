/**
 * Radar de vencimentos.
 *
 * A régua é o tempo até vencer, não o mês do calendário. E o que já
 * venceu vem antes de tudo — é dinheiro na mesa ou cliente prestes a
 * ficar irregular.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  diasAte, faixaVencimento, organizarVencimentos, vencimentosDosContatos, FAIXAS,
} from "../src/shared/upcoming.js";

const HOJE = new Date("2026-09-09T12:00:00Z");

/* ---------------- dias até ---------------- */

test("conta os dias em calendário, ignorando a hora", () => {
  assert.equal(diasAte("2026-09-09", HOJE), 0);
  assert.equal(diasAte("2026-09-19", HOJE), 10);
  assert.equal(diasAte("2026-12-31T23:59:00Z", HOJE), 113);
});

test("data passada é negativa", () => {
  assert.equal(diasAte("2026-09-04", HOJE), -5);
});

test("sem data ou data inválida é null, não zero", () => {
  // Zero é "vence hoje" — o oposto de "não sei". Confundir jogaria todo
  // contato sem data na faixa de urgência máxima.
  assert.equal(diasAte(null, HOJE), null);
  assert.equal(diasAte("", HOJE), null);
  assert.equal(diasAte("qualquer coisa", HOJE), null);
});

/* ---------------- faixas ---------------- */

test("as faixas seguem a distância até o vencimento", () => {
  assert.equal(faixaVencimento(-1), "vencido");
  assert.equal(faixaVencimento(0), "mes");
  assert.equal(faixaVencimento(30), "mes");
  assert.equal(faixaVencimento(31), "sessenta");
  assert.equal(faixaVencimento(60), "sessenta");
  assert.equal(faixaVencimento(90), "noventa");
  assert.equal(faixaVencimento(91), "depois");
  assert.equal(faixaVencimento(null), null);
});

/* ---------------- organização ---------------- */

test("agrupa por urgência, vencido primeiro, e ignora faixa vazia", () => {
  const { grupos, total } = organizarVencimentos([
    { nome: "A", dias: 100 },
    { nome: "B", dias: 5 },
    { nome: "C", dias: -10 },
    { nome: "D", dias: 45 },
  ]);
  assert.equal(total, 4);
  assert.deepEqual(grupos.map((g) => g.id), ["vencido", "mes", "sessenta", "depois"]);
});

test("dentro da faixa, o mais próximo de vencer vem primeiro", () => {
  const { grupos } = organizarVencimentos([
    { nome: "longe", dias: 25 },
    { nome: "perto", dias: 3 },
    { nome: "meio", dias: 15 },
  ]);
  assert.deepEqual(grupos[0].itens.map((i) => i.nome), ["perto", "meio", "longe"]);
});

test("entre vencidos, o que venceu há mais tempo primeiro", () => {
  const { grupos } = organizarVencimentos([
    { nome: "ontem", dias: -1 },
    { nome: "mes passado", dias: -30 },
  ]);
  assert.deepEqual(grupos[0].itens.map((i) => i.nome), ["mes passado", "ontem"]);
});

test("item sem dias não entra", () => {
  const { total } = organizarVencimentos([{ nome: "X", dias: null }, { nome: "Y", dias: 10 }]);
  assert.equal(total, 1);
});

test("toda faixa produzida existe na tabela", () => {
  const ids = new Set(FAIXAS.map((f) => f.id));
  for (const dias of [-5, 0, 20, 45, 75, 200]) assert.ok(ids.has(faixaVencimento(dias)));
});

/* ---------------- extração dos contatos ---------------- */

function contato(id, nome, props) {
  return { externalId: id, title: nome, properties: props };
}
const RECORRENTES = [
  { code: "pobox", nome: "PO Box", icone: "📬",
    vencimentos: [{ key: "cf_pobox", name: "POBox · Vencimento" }] },
  { code: "registration", nome: "Registration", icone: "🚗",
    vencimentos: [{ key: "cf_reg", name: "MV · Vencimento do Registration" }] },
];

test("cruza contatos com os serviços recorrentes", () => {
  const itens = vencimentosDosContatos([
    contato("c1", "Maria", { cf_pobox: "2026-12-31", cf_reg: "2026-09-20" }),
    contato("c2", "João", { cf_reg: "2026-10-15" }),
    contato("c3", "Ana", {}),
  ], RECORRENTES, HOJE);

  // Maria tem dois vencimentos, João um, Ana nenhum.
  assert.equal(itens.length, 3);
  const maria = itens.filter((i) => i.contactId === "c1");
  assert.deepEqual(maria.map((i) => i.servico.code).sort(), ["pobox", "registration"]);
  assert.ok(itens.every((i) => typeof i.dias === "number"));
});

test("campo de vencimento vazio não vira item", () => {
  const itens = vencimentosDosContatos([
    contato("c1", "Maria", { cf_pobox: "", cf_reg: null }),
  ], RECORRENTES, HOJE);
  assert.deepEqual(itens, []);
});

test("cada item carrega serviço, campo e a data para a tela", () => {
  const [item] = vencimentosDosContatos([
    contato("c1", "Maria", { cf_pobox: "2026-12-31" }),
  ], RECORRENTES, HOJE);
  assert.equal(item.servico.nome, "PO Box");
  assert.equal(item.campo, "POBox · Vencimento");
  assert.equal(item.data, "2026-12-31");
  assert.equal(item.nome, "Maria");
});

test("sem recorrentes, nada sai (conta de outro negócio)", () => {
  assert.deepEqual(vencimentosDosContatos([contato("c1", "X", { cf_pobox: "2026-12-31" })], [], HOJE), []);
  assert.deepEqual(vencimentosDosContatos([], RECORRENTES, HOJE), []);
});

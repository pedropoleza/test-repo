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

/* ---------------- o retrato do radar ---------------- */

import { resumoVencimentos, progressoDoPrazo } from "../src/shared/upcoming.js";

/** Itens sintéticos: `[dias, code]`. */
function itensDe(pares) {
  return pares.map(([dias, code], i) => ({
    contactId: `c${i}`,
    nome: `Contato ${i}`,
    servico: { code, nome: code, icone: "" },
    campo: "Vencimento",
    data: "2026-01-01",
    dias,
  }));
}

test("o resumo conta por faixa e as proporções fecham em 100%", () => {
  const resumo = resumoVencimentos(itensDe([
    [-5, "pobox"], [-1, "registration"], [10, "pobox"], [45, "apolice"], [200, "apolice"],
  ]));
  assert.equal(resumo.total, 5);
  const porId = Object.fromEntries(resumo.faixas.map((f) => [f.id, f.total]));
  assert.deepEqual(porId, { vencido: 2, mes: 1, sessenta: 1, noventa: 0, depois: 1 });
  const soma = resumo.faixas.reduce((n, f) => n + f.pct, 0);
  assert.ok(Math.abs(soma - 100) < 1e-9, `as fatias somam ${soma}`);
});

test("a régua mantém as cinco faixas mesmo zeradas", () => {
  // Se a faixa vazia sumisse, a régua dançaria embaixo do cursor a cada
  // filtro e ela clicaria na posição errada.
  const resumo = resumoVencimentos(itensDe([[10, "pobox"]]));
  assert.equal(resumo.faixas.length, 5);
  assert.equal(resumo.faixas.filter((f) => f.total === 0).length, 4);
});

test("resumo de lista vazia não divide por zero", () => {
  const resumo = resumoVencimentos([]);
  assert.equal(resumo.total, 0);
  assert.deepEqual(resumo.servicos, []);
  assert.ok(resumo.faixas.every((f) => f.pct === 0));
});

test("a distribuição põe na frente o serviço com mais vencidos", () => {
  // Volume não é urgência: um serviço com 1 vencido pesa mais que outro
  // com 4 tranquilos, e é o que ela precisa ver primeiro.
  const resumo = resumoVencimentos(itensDe([
    [40, "apolice"], [41, "apolice"], [42, "apolice"], [43, "apolice"],
    [-3, "registration"],
  ]));
  assert.equal(resumo.servicos[0].code, "registration");
  assert.equal(resumo.servicos[0].vencidos, 1);
  assert.equal(resumo.servicos[1].total, 4);
});

test("cada serviço traz a própria quebra por faixa", () => {
  const resumo = resumoVencimentos(itensDe([
    [-2, "registration"], [15, "registration"], [70, "registration"],
  ]));
  const mv = resumo.servicos.find((s) => s.code === "registration");
  assert.equal(mv.total, 3);
  assert.equal(mv.faixas.vencido, 1);
  assert.equal(mv.faixas.mes, 1);
  assert.equal(mv.faixas.noventa, 1);
});

test("a barra do prazo enche conforme o vencimento chega", () => {
  assert.equal(progressoDoPrazo(-1), 1, "vencido é barra cheia");
  assert.equal(progressoDoPrazo(0), 1);
  assert.equal(progressoDoPrazo(90), 0, "no limite da janela, vazia");
  assert.equal(progressoDoPrazo(300), 0, "além da janela não fica negativa");
  assert.equal(progressoDoPrazo(45), 0.5);
  assert.equal(progressoDoPrazo(null), 0);
});

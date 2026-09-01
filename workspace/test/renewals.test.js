/**
 * Renovações de apólice.
 *
 * A regra que precisa valer: o calendário anda sempre para a frente.
 * Uma apólice de março vista em setembro renova em março do ano que vem;
 * se a conta olhar para trás, a tela mostra "vencida" para 67 apólices
 * que estão em dia, e ninguém volta a confiar nela.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  mesDoEstagio, nomeDoMes, ehPipelineDeRenovacao, diasParado, mesesAte,
  faixaDaApolice, organizarRenovacoes, FAIXAS, LIMITE_PARADA,
} from "../src/shared/renewals.js";

const SETEMBRO = new Date("2026-09-15T12:00:00Z");

/* ---------------- ler o mês do nome do estágio ---------------- */

test("reconhece o mês em inglês, em português e abreviado", () => {
  assert.equal(mesDoEstagio("January"), 0);
  assert.equal(mesDoEstagio("janeiro"), 0);
  assert.equal(mesDoEstagio("JAN"), 0);
  assert.equal(mesDoEstagio("March"), 2);
  assert.equal(mesDoEstagio("Março"), 2);
  assert.equal(mesDoEstagio("marco"), 2);
  assert.equal(mesDoEstagio("December"), 11);
});

test("o estágio pode ter sufixo depois do mês", () => {
  assert.equal(mesDoEstagio("March 2026"), 2);
  assert.equal(mesDoEstagio("Maio - renovação"), 4);
});

test("estágio que não é mês devolve null, não zero", () => {
  // Zero é janeiro. Confundir "sem mês" com janeiro joga todo lead novo
  // na faixa de janeiro, que é justamente a que a tela destaca.
  for (const nome of ["Novo Lead", "", null, undefined, "Fechado", "Marketing"]) {
    assert.equal(mesDoEstagio(nome), null, `"${nome}" virou mês`);
  }
});

test("nomeDoMes devolve o nome em português", () => {
  assert.equal(nomeDoMes(0), "Janeiro");
  assert.equal(nomeDoMes(8), "Setembro");
  assert.equal(nomeDoMes(99), "");
});

/* ---------------- que pipeline é um calendário ---------------- */

const dozeMeses = {
  stages: ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"].map((name) => ({ name })),
};

test("a pipeline de apólices é reconhecida como calendário", () => {
  assert.equal(ehPipelineDeRenovacao(dozeMeses), true);
});

test("uma pipeline de funil comum não é calendário", () => {
  assert.equal(ehPipelineDeRenovacao({
    stages: ["Novo Lead", "Contato", "Proposta", "Negociação", "Fechado", "Perdido"]
      .map((name) => ({ name })),
  }), false);
});

test("um punhado de estágios não vira calendário por acaso", () => {
  // Duas etapas chamadas "Maio" e "Junho" num funil de três não são um
  // calendário de renovação: são coincidência.
  assert.equal(ehPipelineDeRenovacao({
    stages: [{ name: "Maio" }, { name: "Junho" }, { name: "Fechado" }],
  }), false);
  assert.equal(ehPipelineDeRenovacao({ stages: [] }), false);
  assert.equal(ehPipelineDeRenovacao(null), false);
});

/* ---------------- quanto falta ---------------- */

test("o calendário anda sempre para a frente", () => {
  assert.equal(mesesAte(8, SETEMBRO), 0);    // setembro: é este mês
  assert.equal(mesesAte(9, SETEMBRO), 1);    // outubro
  assert.equal(mesesAte(11, SETEMBRO), 3);   // dezembro
  assert.equal(mesesAte(2, SETEMBRO), 6);    // março do ano que vem
  assert.equal(mesesAte(7, SETEMBRO), 11);   // agosto: acabou de passar
});

test("mesesAte nunca é negativo, para nenhum mês", () => {
  for (let hoje = 0; hoje < 12; hoje += 1) {
    const agora = new Date(Date.UTC(2026, hoje, 10));
    for (let mes = 0; mes < 12; mes += 1) {
      const falta = mesesAte(mes, agora);
      assert.ok(falta >= 0 && falta <= 11, `mês ${mes} em ${hoje} deu ${falta}`);
    }
  }
});

test("sem mês, não há prazo", () => {
  assert.equal(mesesAte(null, SETEMBRO), null);
  assert.equal(mesesAte(undefined, SETEMBRO), null);
});

/* ---------------- há quanto tempo está parada ---------------- */

test("dias parados sai da última mudança de estágio", () => {
  const dez = new Date(SETEMBRO.getTime() - 10 * 86400000).toISOString();
  assert.equal(diasParado({ lastStageChangeAt: dez }, SETEMBRO), 10);
});

test("sem lastStageChangeAt, cai em updatedAt", () => {
  const cinco = new Date(SETEMBRO.getTime() - 5 * 86400000).toISOString();
  assert.equal(diasParado({ updatedAt: cinco }, SETEMBRO), 5);
});

test("data ausente ou ilegível não vira zero dias", () => {
  // Zero dias significa "mexeram hoje" — o oposto do que sabemos, que é
  // nada. A tela precisa poder dizer "sem registro".
  assert.equal(diasParado({}, SETEMBRO), null);
  assert.equal(diasParado({ lastStageChangeAt: "ontem" }, SETEMBRO), null);
  assert.equal(diasParado(null, SETEMBRO), null);
});

test("data no futuro não vira dias negativos", () => {
  const amanha = new Date(SETEMBRO.getTime() + 86400000).toISOString();
  assert.equal(diasParado({ lastStageChangeAt: amanha }, SETEMBRO), 0);
});

/* ---------------- a faixa de urgência ---------------- */

test("as faixas seguem o prazo", () => {
  assert.equal(faixaDaApolice({ mes: 8, dias: 3 }, SETEMBRO), "mes");
  assert.equal(faixaDaApolice({ mes: 9, dias: 3 }, SETEMBRO), "proximo");
  assert.equal(faixaDaApolice({ mes: 11, dias: 3 }, SETEMBRO), "trimestre");
  assert.equal(faixaDaApolice({ mes: 2, dias: 3 }, SETEMBRO), "depois");
});

test("o prazo manda mais que o abandono", () => {
  // Uma apólice que renova este mês é urgente por si só; dizer que ela
  // está "parada há muito tempo" seria enterrar o prazo.
  assert.equal(faixaDaApolice({ mes: 8, dias: 400 }, SETEMBRO), "mes");
});

test("longe do prazo, o abandono é o que sobra de sinal", () => {
  assert.equal(faixaDaApolice({ mes: 2, dias: LIMITE_PARADA }, SETEMBRO), "parada");
  assert.equal(faixaDaApolice({ mes: 2, dias: LIMITE_PARADA - 1 }, SETEMBRO), "depois");
});

test("sem mês e sem data, cai em 'mais adiante' e não sanga a tela", () => {
  assert.equal(faixaDaApolice({ mes: null, dias: null }, SETEMBRO), "depois");
  assert.equal(faixaDaApolice({ mes: null, dias: 200 }, SETEMBRO), "parada");
});

/* ---------------- a organização da tela ---------------- */

function apolice(nome, estagio, diasAtras) {
  return {
    externalId: nome,
    title: nome,
    properties: { stage: estagio },
    lastStageChangeAt: diasAtras === null
      ? null
      : new Date(SETEMBRO.getTime() - diasAtras * 86400000).toISOString(),
  };
}

test("agrupa na ordem de urgência e ignora faixas vazias", () => {
  const { grupos, total } = organizarRenovacoes([
    apolice("A", "September", 5),
    apolice("B", "October", 5),
    apolice("C", "March", 200),
  ], { agora: SETEMBRO });

  assert.equal(total, 3);
  assert.deepEqual(grupos.map((g) => g.id), ["mes", "proximo", "parada"]);
  assert.deepEqual(grupos.map((g) => g.itens.length), [1, 1, 1]);
});

test("dentro da faixa, o mais esquecido vem primeiro", () => {
  const { grupos } = organizarRenovacoes([
    apolice("recente", "September", 2),
    apolice("antiga", "September", 120),
    apolice("media", "September", 40),
  ], { agora: SETEMBRO });

  assert.deepEqual(grupos[0].itens.map((i) => i.record.title),
    ["antiga", "media", "recente"]);
});

test("a apólice sem data não empurra as outras para baixo", () => {
  // `null` ordenado como número viraria zero ou NaN; qualquer um dos dois
  // desarruma a fila inteira.
  const { grupos } = organizarRenovacoes([
    apolice("semdata", "September", null),
    apolice("parada", "September", 100),
  ], { agora: SETEMBRO });

  assert.deepEqual(grupos[0].itens.map((i) => i.record.title), ["parada", "semdata"]);
});

test("cada item leva o registro inteiro, o mês e os dias", () => {
  const { grupos } = organizarRenovacoes([apolice("X", "September", 7)],
    { agora: SETEMBRO });
  const item = grupos[0].itens[0];
  assert.equal(item.mes, 8);
  assert.equal(item.dias, 7);
  assert.equal(item.record.title, "X");
});

test("dias já calculados pelo servidor têm precedência", () => {
  const r = apolice("Y", "March", 1);
  r.diasParado = 300;
  const { grupos } = organizarRenovacoes([r], { agora: SETEMBRO });
  assert.equal(grupos[0].id, "parada");
});

test("lista vazia devolve nenhum grupo, não um grupo vazio", () => {
  assert.deepEqual(organizarRenovacoes([], { agora: SETEMBRO }), { grupos: [], total: 0 });
});

test("toda faixa produzida existe na tabela de faixas", () => {
  const ids = new Set(FAIXAS.map((f) => f.id));
  const meses = ["January", "May", "September", "October", "December", "Novo Lead"];
  for (const m of meses) {
    for (const dias of [0, 95, null]) {
      const faixa = faixaDaApolice({ mes: mesDoEstagio(m), dias }, SETEMBRO);
      assert.ok(ids.has(faixa), `${m}/${dias} produziu "${faixa}"`);
    }
  }
});

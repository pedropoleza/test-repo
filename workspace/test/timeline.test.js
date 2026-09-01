/**
 * Linha do tempo do contato.
 *
 * O que precisa valer: a lista conta uma HISTÓRIA. Três eventos no mesmo
 * segundo ("criada / mudou de estágio / mudou de status") não são
 * história — é o mesmo fato contado três vezes, e é assim que o CRM
 * devolve toda oportunidade recém-criada.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildTimeline, agruparPorDia, textoDaNota } from "../src/shared/timeline.js";

const T = (iso) => new Date(iso).toISOString();

/* ---------------- o contato como espinha dorsal ---------------- */

test("um contato sem nada mais ainda tem linha do tempo", () => {
  // Notas existem em 2 de 40 contatos desta conta. Se a linha do tempo
  // dependesse delas, 95% das fichas abririam vazias.
  const ev = buildTimeline({
    contact: { dateAdded: "2026-01-10T10:00:00Z", dateUpdated: "2026-01-10T10:00:30Z" },
  });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].titulo, "Entrou na base");
});

test("a origem do contato entra no detalhe", () => {
  const [ev] = buildTimeline({
    contact: { dateAdded: "2026-01-10T10:00:00Z", source: "Five Rings" },
  });
  assert.equal(ev.detalhe, "Origem: Five Rings");
});

test("'atualizado' só aparece quando é notícia", () => {
  const perto = buildTimeline({
    contact: { dateAdded: "2026-01-10T10:00:00Z", dateUpdated: "2026-01-10T10:00:30Z" },
  });
  assert.equal(perto.length, 1, "meio minuto depois é o mesmo momento");

  const longe = buildTimeline({
    contact: { dateAdded: "2026-01-10T10:00:00Z", dateUpdated: "2026-03-01T10:00:00Z" },
  });
  assert.equal(longe.length, 2);
  assert.equal(longe[0].titulo, "Dados atualizados");
});

/* ---------------- oportunidades sem repetir o mesmo fato ---------------- */

const AGORA = "2026-09-01T15:59:03.025Z";

test("oportunidade recém-criada vira UM evento, não três", () => {
  // É exatamente o que o CRM devolve: createdAt, lastStageChangeAt e
  // lastStatusChangeAt no mesmo instante.
  const ev = buildTimeline({
    opportunities: [{
      name: "Ranile - LS155937500", stage: "September", status: "open",
      createdAt: AGORA, lastStageChangeAt: AGORA, lastStatusChangeAt: AGORA,
    }],
  });
  assert.equal(ev.length, 1);
  assert.match(ev[0].titulo, /Oportunidade criada/);
});

test("mudança de estágio posterior à criação vira evento próprio", () => {
  const ev = buildTimeline({
    opportunities: [{
      name: "Apólice", stage: "November",
      createdAt: "2026-06-26T20:08:56Z",
      lastStageChangeAt: "2026-09-01T16:00:00Z",
      lastStatusChangeAt: "2026-06-26T20:08:56Z",
    }],
  });
  assert.deepEqual(ev.map((e) => e.tipo), ["estagio", "oportunidade"]);
  assert.equal(ev[0].detalhe, "Agora em November");
});

test("estágio e status mudados em momentos diferentes contam os dois", () => {
  const ev = buildTimeline({
    opportunities: [{
      name: "Apólice", stage: "November", status: "won",
      createdAt: "2026-01-01T00:00:00Z",
      lastStageChangeAt: "2026-02-01T00:00:00Z",
      lastStatusChangeAt: "2026-03-01T00:00:00Z",
    }],
  });
  assert.deepEqual(ev.map((e) => e.tipo), ["status", "estagio", "oportunidade"]);
});

test("o responsável aparece pelo nome, nunca pelo id", () => {
  const users = new Map([["QbNsoXzaEdKDEImwSAhz", "Daniely Jones"]]);
  const [ev] = buildTimeline({
    users,
    opportunities: [{ name: "X", createdAt: AGORA, assignedTo: "QbNsoXzaEdKDEImwSAhz" }],
  });
  assert.equal(ev.ator, "Daniely Jones");
});

test("id desconhecido não vaza para a tela", () => {
  const [ev] = buildTimeline({
    users: new Map(),
    opportunities: [{ name: "X", createdAt: AGORA, assignedTo: "id_orfao" }],
  });
  assert.equal(ev.ator, "");
});

/* ---------------- notas ---------------- */

test("a nota entra sem HTML", () => {
  const [ev] = buildTimeline({
    notes: [{
      dateAdded: AGORA,
      body: '<p style="line-height: 1.2;">Talisson | Aposentadoria</p><p>DN: 11/05/1997</p>',
    }],
  });
  assert.equal(ev.tipo, "nota");
  assert.equal(ev.detalhe, "Talisson | Aposentadoria DN: 11/05/1997");
  assert.ok(!ev.detalhe.includes("<"), "sobrou marcação no texto");
});

test("bodyText tem precedência sobre o HTML", () => {
  const [ev] = buildTimeline({
    notes: [{ dateAdded: AGORA, bodyText: "texto limpo", body: "<p>marcado</p>" }],
  });
  assert.equal(ev.detalhe, "texto limpo");
});

test("nota longa é resumida, não jogada inteira na linha", () => {
  const [ev] = buildTimeline({ notes: [{ dateAdded: AGORA, bodyText: "a".repeat(400) }] });
  assert.ok(ev.detalhe.length <= 180, `veio com ${ev.detalhe.length}`);
  assert.ok(ev.detalhe.endsWith("…"));
});

test("entidades HTML viram os caracteres de verdade", () => {
  assert.equal(textoDaNota({ body: "Jones &amp; Filhos &quot;seguros&quot;" }),
    'Jones & Filhos "seguros"');
});

/* ---------------- revisões da ficha ---------------- */

test("o que editamos na ficha entra na mesma lista", () => {
  const users = new Map([["u_1", "Daniely Jones"]]);
  const [ev] = buildTimeline({
    users,
    revisions: [{ created_at: AGORA, operation: "update", actor: "u_1" }],
  });
  assert.equal(ev.tipo, "ficha");
  assert.equal(ev.titulo, "Bloco editado na ficha");
  assert.equal(ev.ator, "Daniely Jones");
});

test("a chave interna da sessão não vaza como se fosse gente", () => {
  // Em conta fixa o `actor` é algo como "fixed:loc_ABC". Mostrar isso
  // ao lado da hora faz a ficha dizer que uma string editou a página.
  const [ev] = buildTimeline({
    users: new Map(),
    revisions: [{ created_at: AGORA, operation: "create", actor: "fixed:smoke-tenant" }],
  });
  assert.equal(ev.ator, "");
  assert.equal(ev.titulo, "Bloco criado na ficha");
});

test("operação desconhecida não vira texto quebrado", () => {
  const [ev] = buildTimeline({ revisions: [{ created_at: AGORA, operation: "zzz" }] });
  assert.equal(ev.titulo, "Ficha alterada");
});

/* ---------------- a ordem e os limites ---------------- */

test("do mais recente para o mais antigo, misturando as fontes", () => {
  const ev = buildTimeline({
    contact: { dateAdded: "2026-01-01T00:00:00Z" },
    opportunities: [{ name: "O", createdAt: "2026-05-01T00:00:00Z" }],
    notes: [{ dateAdded: "2026-03-01T00:00:00Z", bodyText: "n" }],
    revisions: [{ created_at: "2026-07-01T00:00:00Z", operation: "update" }],
  });
  assert.deepEqual(ev.map((e) => e.tipo), ["ficha", "oportunidade", "nota", "contato"]);
});

test("data ausente ou ilegível não entra como 'agora'", () => {
  // Um evento sem data ordenado como NaN some no meio da lista e mente
  // sobre quando aconteceu.
  const ev = buildTimeline({
    notes: [{ bodyText: "sem data" }, { dateAdded: "não é data", bodyText: "x" }],
    opportunities: [{ name: "sem data" }],
  });
  assert.deepEqual(ev, []);
});

test("o limite corta os mais antigos, não os mais novos", () => {
  const notes = Array.from({ length: 10 }, (_, i) => ({
    dateAdded: T(`2026-0${i + 1 <= 9 ? i + 1 : 9}-01T00:00:00Z`), bodyText: `n${i}`,
  }));
  const ev = buildTimeline({ notes, limit: 3 });
  assert.equal(ev.length, 3);
  assert.ok(new Date(ev[0].at) > new Date(ev[2].at));
});

test("toda data sai em ISO, venha de onde vier", () => {
  const ev = buildTimeline({
    contact: { dateAdded: new Date("2026-01-01T00:00:00Z") },
    notes: [{ dateAdded: 1767225600000, bodyText: "n" }],
  });
  for (const e of ev) assert.match(e.at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test("sem nenhuma fonte, a lista é vazia e não quebra", () => {
  assert.deepEqual(buildTimeline(), []);
  assert.deepEqual(buildTimeline({}), []);
});

/* ---------------- agrupamento por dia ---------------- */

test("eventos do mesmo dia ficam juntos, na ordem que chegaram", () => {
  const grupos = agruparPorDia([
    { at: "2026-09-01T16:00:00.000Z" },
    { at: "2026-09-01T09:00:00.000Z" },
    { at: "2026-08-30T09:00:00.000Z" },
  ]);
  assert.deepEqual(grupos.map((g) => g.dia), ["2026-09-01", "2026-08-30"]);
  assert.deepEqual(grupos.map((g) => g.eventos.length), [2, 1]);
});

test("o mesmo dia separado por outro não se funde", () => {
  // Fundir exigiria reordenar, e a ordem cronológica é o que a tela
  // promete. Dias repetidos aqui significam lista fora de ordem.
  const grupos = agruparPorDia([
    { at: "2026-09-01T16:00:00.000Z" },
    { at: "2026-08-30T09:00:00.000Z" },
    { at: "2026-09-01T09:00:00.000Z" },
  ]);
  assert.equal(grupos.length, 3);
});

test("lista vazia agrupa em nada", () => {
  assert.deepEqual(agruparPorDia([]), []);
  assert.deepEqual(agruparPorDia(), []);
});

/* ---------------- a nota chega limpa na ficha e no PDF ---------------- */

test("a nota do CRM não leva HTML para a ficha nem para o PDF", () => {
  // As duas saídas mostram texto puro: a ficha renderiza sem innerHTML e
  // o PDF é Helvetica. Antes, o `body` cru virava "<p style=…>" literal
  // na tela e no papel.
  const bruta = {
    body: '<p style="line-height: 1.2; padding-left: 0px !important;">Talisson | Aposentadoria</p>'
      + '<p><span style="color: rgb(16, 24, 40);">Estado: Massachusetts</span></p>',
  };
  const limpo = textoDaNota(bruta);
  assert.equal(limpo, "Talisson | Aposentadoria Estado: Massachusetts");
  assert.ok(!/[<>]/.test(limpo), "sobrou marcação");
});

test("nota vazia não vira string com lixo", () => {
  assert.equal(textoDaNota({ body: "<p></p>" }), "");
  assert.equal(textoDaNota({}), "");
  assert.equal(textoDaNota(null), "");
});

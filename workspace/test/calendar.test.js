/**
 * Calendário de vencimentos.
 *
 * A grade tem que ser sempre semanas fechadas de sete dias começando no
 * domingo, custe o que custar o mês; e cada vencimento tem que pousar no
 * dia certo em UTC, sem a hora empurrar para a véspera.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  chaveDia, mesAnterior, mesSeguinte, mesDeHoje, rotuloMes,
  matrizDoMes, agruparPorDia, DIAS_SEMANA,
} from "../src/shared/calendar.js";

/* ---------------- chaveDia ---------------- */

test("chaveDia normaliza para YYYY-MM-DD em UTC", () => {
  assert.equal(chaveDia("2026-09-30"), "2026-09-30");
  // 23:30 em UTC continua sendo dia 30, não vira o 01.
  assert.equal(chaveDia("2026-09-30T23:30:00Z"), "2026-09-30");
  assert.equal(chaveDia(new Date("2026-01-05T00:00:00Z")), "2026-01-05");
});

test("chaveDia devolve null para vazio ou inválido", () => {
  assert.equal(chaveDia(null), null);
  assert.equal(chaveDia(""), null);
  assert.equal(chaveDia("não é data"), null);
});

/* ---------------- navegação de mês ---------------- */

test("mês anterior e seguinte viram o ano", () => {
  assert.deepEqual(mesAnterior({ ano: 2026, mes: 0 }), { ano: 2025, mes: 11 });
  assert.deepEqual(mesSeguinte({ ano: 2026, mes: 11 }), { ano: 2027, mes: 0 });
  assert.deepEqual(mesAnterior({ ano: 2026, mes: 8 }), { ano: 2026, mes: 7 });
  assert.deepEqual(mesSeguinte({ ano: 2026, mes: 8 }), { ano: 2026, mes: 9 });
});

test("mesDeHoje lê ano e mês em UTC", () => {
  assert.deepEqual(mesDeHoje(new Date("2026-09-09T12:00:00Z")), { ano: 2026, mes: 8 });
});

test("rotuloMes escreve o mês em português", () => {
  assert.equal(rotuloMes({ ano: 2026, mes: 8 }), "Setembro 2026");
  assert.equal(rotuloMes({ ano: 2026, mes: 0 }), "Janeiro 2026");
});

/* ---------------- matriz do mês ---------------- */

test("cada semana tem 7 dias e começa no domingo", () => {
  const semanas = matrizDoMes({ ano: 2026, mes: 8 }); // setembro/2026
  assert.ok(semanas.length >= 4 && semanas.length <= 6);
  for (const semana of semanas) {
    assert.equal(semana.length, 7);
    // Primeira coluna é sempre um domingo.
    const d = new Date(`${semana[0].iso}T00:00:00Z`);
    assert.equal(d.getUTCDay(), 0);
  }
  assert.equal(DIAS_SEMANA[0], "Dom");
});

test("o dia 1 do mês aparece marcado como do mês, e os vizinhos não", () => {
  // Set/2026: dia 1 é terça. A primeira semana traz o fim de agosto como
  // preenchimento (mesAtual:false) até chegar no dia 1 (mesAtual:true).
  const semanas = matrizDoMes({ ano: 2026, mes: 8 });
  const todas = semanas.flat();
  const primeiro = todas.find((c) => c.iso === "2026-09-01");
  assert.ok(primeiro && primeiro.mesAtual === true);
  const agosto = todas.find((c) => c.iso === "2026-08-31");
  assert.ok(agosto && agosto.mesAtual === false);
});

test("todos os dias do mês estão na grade, sem faltar nenhum", () => {
  const semanas = matrizDoMes({ ano: 2026, mes: 1 }); // fev/2026 (28 dias)
  const doMes = semanas.flat().filter((c) => c.mesAtual).map((c) => c.dia);
  assert.deepEqual(doMes, Array.from({ length: 28 }, (_, i) => i + 1));
});

/* ---------------- agrupamento por dia ---------------- */

test("agruparPorDia junta os itens na chave do dia", () => {
  const itens = [
    { nome: "Ana",  data: "2026-09-10", servico: { nome: "PO Box" } },
    { nome: "Beto", data: "2026-09-10T22:00:00Z", servico: { nome: "Annual" } },
    { nome: "Cida", data: "2026-09-15", servico: { nome: "PO Box" } },
  ];
  const mapa = agruparPorDia(itens);
  assert.equal(mapa.get("2026-09-10").length, 2);
  assert.equal(mapa.get("2026-09-15").length, 1);
  // Ordena por serviço dentro do dia: Annual antes de PO Box.
  assert.equal(mapa.get("2026-09-10")[0].nome, "Beto");
});

test("agruparPorDia descarta itens sem data", () => {
  const mapa = agruparPorDia([
    { nome: "Sem data", data: null, servico: { nome: "X" } },
    { nome: "Com data", data: "2026-09-10", servico: { nome: "X" } },
  ]);
  assert.equal(mapa.size, 1);
  assert.ok(mapa.has("2026-09-10"));
});

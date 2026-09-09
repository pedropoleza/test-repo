/**
 * Agenda operacional.
 *
 * A semana começa na segunda; o atrasado é backlog que não some ao virar
 * a página da semana; o parado (sem data) fica no seu trilho e nunca cai
 * num dia. E a data continua em UTC de calendário, sem a hora empurrar
 * para a véspera.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  chaveDia, inicioDaSemana, semanaAnterior, semanaSeguinte,
  diasDaSemana, rotuloSemana, montarAgenda,
} from "../src/shared/agenda.js";

const HOJE = new Date("2026-09-09T12:00:00Z"); // quarta-feira

/* ---------------- chaveDia ---------------- */

test("chaveDia normaliza para YYYY-MM-DD em UTC", () => {
  assert.equal(chaveDia("2026-09-30"), "2026-09-30");
  assert.equal(chaveDia("2026-09-30T23:30:00Z"), "2026-09-30");
  assert.equal(chaveDia(null), null);
  assert.equal(chaveDia("nada"), null);
});

/* ---------------- semana ---------------- */

test("inicioDaSemana recua até a segunda-feira", () => {
  // 2026-09-09 é quarta; a segunda da semana é 2026-09-07.
  assert.equal(chaveDia(inicioDaSemana(HOJE)), "2026-09-07");
  // Numa segunda, é o próprio dia.
  assert.equal(chaveDia(inicioDaSemana(new Date("2026-09-07T00:00:00Z"))), "2026-09-07");
  // Num domingo, recua seis dias.
  assert.equal(chaveDia(inicioDaSemana(new Date("2026-09-13T00:00:00Z"))), "2026-09-07");
});

test("semana anterior e seguinte andam de 7 em 7 dias", () => {
  const seg = inicioDaSemana(HOJE);
  assert.equal(chaveDia(semanaAnterior(seg)), "2026-08-31");
  assert.equal(chaveDia(semanaSeguinte(seg)), "2026-09-14");
});

test("diasDaSemana devolve 7 dias, segunda a domingo, com rótulo", () => {
  const dias = diasDaSemana(inicioDaSemana(HOJE));
  assert.equal(dias.length, 7);
  assert.equal(dias[0].iso, "2026-09-07");
  assert.equal(dias[0].rotulo, "Seg 7");
  assert.equal(dias[6].iso, "2026-09-13");
  assert.equal(dias[6].fimDeSemana, true);   // domingo
  assert.equal(dias[0].fimDeSemana, false);  // segunda
});

test("rotuloSemana descreve o intervalo com o ano", () => {
  assert.equal(rotuloSemana(inicioDaSemana(HOJE)), "7 set – 13 set 2026");
});

/* ---------------- montarAgenda ---------------- */

const inicioSemana = inicioDaSemana(HOJE); // 2026-09-07

test("datado no futuro dentro da semana cai no dia certo", () => {
  const datados = [
    { tipo: "renovacao", iso: "2026-09-10", titulo: "Ana", detalhe: "PO Box" },
    { tipo: "tarefa",    iso: "2026-09-10", titulo: "Ligar p/ Beto", detalhe: "Sam" },
  ];
  const { dias } = montarAgenda({ datados, inicioSemana, agora: HOJE });
  const quinta = dias.find((d) => d.iso === "2026-09-10");
  assert.equal(quinta.itens.length, 2);
  // Renovação vem antes de tarefa no mesmo dia.
  assert.equal(quinta.itens[0].tipo, "renovacao");
  assert.equal(quinta.itens[1].tipo, "tarefa");
});

test("datado antes de hoje vira Atrasado, não some", () => {
  const datados = [
    { tipo: "renovacao", iso: "2026-09-05", titulo: "Vencido A", detalhe: "PO Box" },
    { tipo: "tarefa",    iso: "2026-09-01", titulo: "Vencido B", detalhe: "" },
  ];
  const { atrasados, dias } = montarAgenda({ datados, inicioSemana, agora: HOJE });
  assert.equal(atrasados.length, 2);
  // Mais antigo primeiro.
  assert.equal(atrasados[0].titulo, "Vencido B");
  // E nenhum deles caiu num dia da semana.
  assert.equal(dias.reduce((n, d) => n + d.itens.length, 0), 0);
});

test("hoje é marcado no dia certo", () => {
  const { dias } = montarAgenda({ datados: [], inicioSemana, agora: HOJE });
  const hoje = dias.find((d) => d.hoje);
  assert.equal(hoje.iso, "2026-09-09");
});

test("datado depois da semana não aparece nesta janela", () => {
  const datados = [{ tipo: "renovacao", iso: "2026-09-20", titulo: "Longe", detalhe: "" }];
  const { dias, atrasados } = montarAgenda({ datados, inicioSemana, agora: HOJE });
  assert.equal(atrasados.length, 0);
  assert.equal(dias.reduce((n, d) => n + d.itens.length, 0), 0);
});

test("parados não têm data e vêm ordenados do mais parado ao menos", () => {
  const parados = [
    { titulo: "Cida", detalhe: "Aguardando docs", tipo: "cliente", dias: 3 },
    { titulo: "Duda", detalhe: "Aguardando terceiro", tipo: "terceiro", dias: 30 },
  ];
  const res = montarAgenda({ datados: [], parados, inicioSemana, agora: HOJE });
  assert.equal(res.parados[0].titulo, "Duda");   // 30 dias primeiro
  assert.equal(res.parados[1].titulo, "Cida");
  assert.equal(res.totalParados, 2);
  // Parado nunca entra num dia.
  assert.equal(res.dias.reduce((n, d) => n + d.itens.length, 0), 0);
});

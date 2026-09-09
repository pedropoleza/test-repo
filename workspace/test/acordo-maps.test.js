/**
 * Mapas dos acordos.
 *
 * O que precisa valer: todo acordo que a ficha oferece gera um PDF
 * válido de verdade. Um mapa apontando para página que não existe, ou um
 * PDF que o pdf-lib corrompe no save, viraria um download quebrado na mão
 * do cliente — e o documento é assinável.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { preencherAcordo } from "../lib/server/document-fill.js";
import { MAPAS, montarValores } from "../lib/server/acordo-maps.js";
import { paginasDoAcordo } from "../lib/server/document-fill.js";

const ENTRADA = {
  contact: { contactName: "Maria Test", address1: "1 Main St", postalCode: "07740" },
  record: { title: "Maria Test", properties: {
    email: "maria@test.com", phone: "+1 732 555 0000", city: "Long Branch", state: "NJ",
  } },
  columns: [],
};

test("todo acordo com mapa gera um PDF válido", async () => {
  for (const slug of Object.keys(MAPAS)) {
    const valores = montarValores(slug, ENTRADA);
    const bytes = await preencherAcordo({ slug, valores, mapa: MAPAS[slug].mapa });
    assert.ok(bytes.length > 1000, `${slug} saiu pequeno demais`);
    // Assinatura do PDF — o save não pode ter corrompido o arquivo.
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-", `${slug} não é PDF`);
  }
});

test("nenhum campo do mapa aponta para página inexistente", async () => {
  // O bug do off-by-one: um pg 1-indexado virando índice 0-indexado
  // colocava o valor na página errada. A trava é objetiva — a página
  // referida tem que existir no documento.
  for (const [slug, def] of Object.entries(MAPAS)) {
    const total = await paginasDoAcordo(slug);
    for (const campo of def.mapa) {
      assert.ok(campo.page < total,
        `${slug}: campo "${campo.campo}" aponta pág ${campo.page}, doc tem ${total}`);
    }
  }
});

test("o master gera mesmo sem campo para preencher", async () => {
  // É o guarda-chuva: nenhum campo, "gerar" é entregar o PDF como está.
  const bytes = await preencherAcordo({ slug: "master", valores: {}, mapa: MAPAS.master.mapa });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
});

test("o divórcio preenche o bloco do cliente com os dados do contato", async () => {
  const v = montarValores("divorce-pt", ENTRADA);
  assert.equal(v.nome, "Maria Test");
  assert.equal(v.telefone, "+1 732 555 0000");
  assert.equal(v.email, "maria@test.com");
});

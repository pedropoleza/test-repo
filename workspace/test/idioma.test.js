/**
 * O idioma do contato.
 *
 * É a chave que faz documento, portal e lembrete saírem na língua certa
 * sozinhos. E a regra que separa "traduzir a interface" de "traduzir o
 * contrato": só o documento com variante oficial troca de língua.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  idiomaDoContato, idiomaDoAcordo, documentoEmOutraLingua,
} from "../src/shared/idioma.js";
import { idiomaDoCliente } from "../src/shared/client-status.js";

const colunas = (nome) => [{ key: "cf_1", name: nome }];

test("lê o idioma do campo personalizado do CRM", () => {
  const ctx = { record: { properties: { cf_1: "Espanhol" } }, columns: colunas("Idioma") };
  assert.equal(idiomaDoContato(ctx), "es");
});

test("reconhece o campo em inglês e em espanhol", () => {
  assert.equal(idiomaDoContato({ record: { properties: { cf_1: "English" } }, columns: colunas("Language") }), "en");
  assert.equal(idiomaDoContato({ record: { properties: { cf_1: "Português" } }, columns: colunas("Lengua") }), "pt");
});

test("cai no campo padrão do contato quando não há campo personalizado", () => {
  assert.equal(idiomaDoContato({ contact: { locale: "en-US" } }), "en");
});

test("sem nada, usa o padrão da conta e nunca devolve vazio", () => {
  assert.equal(idiomaDoContato({}), "pt");
  assert.equal(idiomaDoContato({}, "en"), "en");
});

test("campo vazio não conta como idioma", () => {
  const ctx = { record: { properties: { cf_1: "   " } }, columns: colunas("Idioma"), contact: {} };
  assert.equal(idiomaDoContato(ctx), "pt");
});

/* ---------------- variante do documento ---------------- */

const DIVORCIO = { idiomas: ["pt", "en", "es"] };
const POBOX = { idiomas: ["en"] };

test("documento com variante oficial acompanha o cliente", () => {
  assert.equal(idiomaDoAcordo(DIVORCIO, "es"), "es");
  assert.equal(idiomaDoAcordo(DIVORCIO, "pt"), "pt");
});

test("documento sem variante fica no original — não se traduz contrato", () => {
  assert.equal(idiomaDoAcordo(POBOX, "pt"), "en");
  assert.equal(idiomaDoAcordo(POBOX, "es"), "en");
});

test("sabe dizer quando o documento vai em outra língua que a do cliente", () => {
  assert.equal(documentoEmOutraLingua(POBOX, "pt"), true);
  assert.equal(documentoEmOutraLingua(POBOX, "en"), false);
  assert.equal(documentoEmOutraLingua(DIVORCIO, "pt"), false);
});

/* ---------------- rótulos do dropdown "Idioma" ---------------- */

test("entende os rótulos que o dropdown do CRM costuma ter", () => {
  const casos = [
    ["Português", "pt"], ["Português (BR)", "pt"], ["PT", "pt"], ["pt-BR", "pt"],
    ["Español", "es"], ["Espanhol", "es"], ["Spanish", "es"], ["ES", "es"],
    ["es-MX", "es"], ["Castellano", "es"],
    ["English", "en"], ["Inglês", "en"], ["Inglés", "en"], ["EN", "en"], ["en-US", "en"],
  ];
  for (const [rotulo, esperado] of casos) {
    assert.equal(idiomaDoCliente(rotulo), esperado, rotulo);
  }
});

test("\"Portugues\" sem acento não pode virar espanhol", () => {
  // Regressão: o casamento por substring de código curto fazia "portugues"
  // (que termina em "es") cair em espanhol — e o cliente brasileiro
  // receberia a página na língua errada sem ninguém perceber.
  assert.equal(idiomaDoCliente("Portugues"), "pt");
  assert.equal(idiomaDoCliente("portugues"), "pt");
});

test("vazio e lixo caem no padrão, nunca em vazio", () => {
  assert.equal(idiomaDoCliente(""), "pt");
  assert.equal(idiomaDoCliente(null), "pt");
  assert.equal(idiomaDoCliente("qualquer coisa"), "pt");
});

test("o dropdown Idioma do contato atravessa até a escolha do documento", () => {
  // O caminho inteiro: campo do CRM -> idioma do contato -> variante do PDF.
  const ctx = { record: { properties: { cf_1: "Espanhol" } }, columns: [{ key: "cf_1", name: "Idioma" }] };
  const lang = idiomaDoContato(ctx);
  assert.equal(lang, "es");
  assert.equal(idiomaDoAcordo({ idiomas: ["pt", "en", "es"] }, lang), "es");
  assert.equal(idiomaDoAcordo({ idiomas: ["en"] }, lang), "en");
});

/**
 * Render do portal de status.
 *
 * A página sai no idioma pedido, escapa o que vem do CRM (nome, serviço),
 * marca o que precisa de ação do cliente e não vaza o token noindex à
 * parte. Sem serviço, mostra a frase de vazio, não uma lista em branco.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { renderHtml } from "../api/status.js";

const DADOS = {
  nome: "Ana",
  servicos: [
    { nome: "P.O. Box", status: "Aguardando seus documentos", categoria: "documentos", acaoCliente: true },
    { nome: "LLC", status: "Em andamento", categoria: "processando", acaoCliente: false },
  ],
};

test("sai no idioma e com a saudação", () => {
  const html = renderHtml(DADOS, "pt", "tok123456789012345678901234");
  assert.match(html, /<html lang="pt"/);
  assert.match(html, /Olá, Ana/);
  assert.match(html, /P\.O\. Box/);
  assert.match(html, /Aguardando seus documentos/);
});

test("marca o serviço que precisa de ação do cliente", () => {
  const html = renderHtml(DADOS, "pt", "tok123456789012345678901234");
  // A badge "Precisa de você" aparece uma vez (só o serviço com acaoCliente).
  assert.equal((html.match(/Precisa de você/g) || []).length, 1);
});

test("escapa conteúdo do CRM", () => {
  const html = renderHtml(
    { nome: "<b>x</b>", servicos: [{ nome: "<script>alert(1)</script>", status: "ok", categoria: "processando", acaoCliente: false }] },
    "pt", "tok123456789012345678901234",
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("sem serviço, frase de vazio", () => {
  const html = renderHtml({ nome: "", servicos: [] }, "en", "tok123456789012345678901234");
  assert.match(html, /No active services/);
});

test("troca de idioma aponta para os outros dois", () => {
  const html = renderHtml(DADOS, "es", "TOKENabcdefghij1234567890");
  assert.match(html, /lang=pt/);
  assert.match(html, /lang=en/);
  assert.match(html, /noindex/);
});

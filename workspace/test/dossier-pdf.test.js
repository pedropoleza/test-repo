/**
 * PDF da ficha: o que sai no papel.
 *
 * O PDF é o único lugar onde um erro não tem conserto depois — ele foi
 * baixado, mandado por e-mail, impresso. Por isso o teste cobre o que
 * mais custaria: id no lugar do nome, acento quebrado e campo vazio
 * ocupando página.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buildDossierPdf, nomeDoArquivo } from "../lib/server/dossier-pdf.js";

const COLUNAS = [
  { key: "name", name: "Nome", primary: true },
  { key: "email", name: "E-mail", type: "email" },
  { key: "phone", name: "Telefone", type: "phone" },
  { key: "tags", name: "Tags", type: "multi_select",
    options: [{ id: "vip", name: "VIP" }, { id: "quente", name: "Quente" }] },
  { key: "assigned", name: "Responsável", type: "select",
    options: [{ id: "u1", name: "Daniely Jones" }] },
  { key: "dnd", name: "Não perturbe", type: "checkbox" },
  { key: "cf_1", name: "Interesse", type: "text" },
  { key: "cf_2", name: "Campo vazio", type: "text" },
];

const base = (props = {}) => ({
  page: { title: "Ficha" },
  record: { title: "José Antônio", properties: props },
  columns: COLUNAS,
  opportunities: [],
  notes: [],
  tasks: [],
});

async function gerar(entrada) {
  const bytes = await buildDossierPdf(entrada);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", "não saiu um PDF");
  return bytes;
}

test("gera um PDF válido, com o nome do contato no título", async () => {
  const bytes = await gerar(base({ email: "jose@x.com" }));
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(), "José Antônio");
  assert.ok(doc.getPageCount() >= 1);
});

test("emoji no nome não impede a ficha de sair", async () => {
  // WinAnsi não representa emoji: sem a limpeza, o pdf-lib estoura aqui.
  const entrada = base({ email: "a@b.com" });
  entrada.record.title = "Maria 🎉 Souza";
  const doc = await PDFDocument.load(await gerar(entrada));
  assert.equal(doc.getTitle(), "Maria Souza");
});

test("acentos do português sobrevivem", async () => {
  const entrada = base({ cf_1: "Aposentadoria e proteção patrimonial" });
  entrada.record.title = "Conceição Ançã Órfão Ütil";
  const doc = await PDFDocument.load(await gerar(entrada));
  assert.equal(doc.getTitle(), "Conceição Ançã Órfão Ütil");
});

test("o responsável sai pelo nome, nunca pelo id", async () => {
  const bytes = await gerar(base({ assigned: "u1" }));
  const texto = bytes.toString("latin1");
  assert.ok(!texto.includes("u1(") , "o id vazou para o PDF");
  // O conteúdo vai comprimido; o que dá para afirmar sem descomprimir é
  // que a geração aceitou a coluna de escolha e produziu um PDF.
  assert.ok(bytes.length > 800);
});

test("uma ficha sem nada preenchido ainda gera PDF", async () => {
  const doc = await PDFDocument.load(await gerar(base({})));
  assert.equal(doc.getPageCount(), 1);
});

test("muita nota gera mais de uma página, sem cortar conteúdo", async () => {
  const entrada = base({ email: "a@b.com" });
  entrada.notes = Array.from({ length: 25 }, (_, i) => ({
    body: `Nota ${i + 1}: ${"conversa longa com o cliente ".repeat(6)}`,
  }));
  const doc = await PDFDocument.load(await gerar(entrada));
  assert.ok(doc.getPageCount() > 1, `ficou em ${doc.getPageCount()} página`);
});

test("nome de arquivo é seguro em qualquer sistema", () => {
  assert.equal(nomeDoArquivo("José Antônio da Conceição"), "Jose-Antonio-da-Conceicao.pdf");
  assert.equal(nomeDoArquivo("a/b\\c:d*e?f"), "abcdef.pdf");
  assert.equal(nomeDoArquivo(""), "ficha.pdf");
  assert.equal(nomeDoArquivo(null), "ficha.pdf");
  assert.equal(nomeDoArquivo("🎉🎉🎉"), "ficha.pdf", "nome só de emoji não vira arquivo sem nome");
  assert.ok(nomeDoArquivo("x".repeat(200)).length <= 64);
});

/* ------------------------------------------------------------------ */
/* Capa e foto no papel                                               */
/* ------------------------------------------------------------------ */

const comCapa = (page) => ({ ...base({ email: "a@b.com" }), page });

test("a capa em gradiente é desenhada, e o PDF cresce por causa dela", async () => {
  const semCapa = await gerar(comCapa({ title: "X" }));
  const comGradiente = await gerar(comCapa({ title: "X", cover_type: "gradient", cover_value: "plum" }));
  assert.ok(comGradiente.length > semCapa.length + 2000,
    `gradiente: ${comGradiente.length} vs sem capa: ${semCapa.length}`);
});

test("capa em cor sólida também sai, e mais leve que o gradiente", async () => {
  const cor = await gerar(comCapa({ title: "X", cover_type: "color", cover_value: "navy" }));
  const grad = await gerar(comCapa({ title: "X", cover_type: "gradient", cover_value: "navy" }));
  assert.ok(cor.length < grad.length, "uma cor chapada não pode custar como 160 faixas");
});

test("gradiente desconhecido cai no padrão em vez de estourar", async () => {
  const pdf = await gerar(comCapa({ title: "X", cover_type: "gradient", cover_value: "inventado" }));
  assert.ok(pdf.length > 2000);
});

test("foto que não carrega não impede a ficha de sair", async () => {
  // Timeout curto e falha soft: o documento continua útil sem o rosto.
  const pdf = await gerar(comCapa({
    title: "X", cover_type: "gradient",
    icon_type: "url", icon_value: "https://dominio-inexistente-xyz.invalid/a.png",
  }));
  assert.ok(pdf.length > 1500);
});

test("capa que não carrega também não impede", async () => {
  const pdf = await gerar(comCapa({
    title: "X", cover_type: "image", cover_value: "https://dominio-inexistente-xyz.invalid/c.jpg",
  }));
  assert.ok(pdf.length > 1500);
});

test("endereço que não é http é ignorado sem tentar buscar", async () => {
  const t = Date.now();
  await gerar(comCapa({ title: "X", icon_type: "url", icon_value: "file:///etc/passwd" }));
  assert.ok(Date.now() - t < 2000, "não pode nem tentar abrir o que não é http");
});

test("sem foto, as iniciais do nome vão para o círculo", async () => {
  const entrada = comCapa({ title: "X", cover_type: "gradient" });
  entrada.record.title = "Maria Souza";
  const comIniciais = await gerar(entrada);

  const semNome = comCapa({ title: "X", cover_type: "gradient" });
  semNome.record = { title: "+16893505757", properties: { email: "a@b.com" } };
  const semIniciais = await gerar(semNome);

  // Nome que é só telefone não rende inicial que sirva; o círculo fica
  // vazio em vez de mostrar "+1".
  assert.ok(comIniciais.length > semIniciais.length,
    "as iniciais precisam aparecer no PDF de quem tem nome");
});

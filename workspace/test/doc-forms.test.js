/**
 * O formulário de cada documento.
 *
 * O que se pergunta ao cliente, com rótulo na língua dele, e o que não
 * pode ir em branco.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  camposDoAcordo, secoesDoAcordo, validar, rotulo, texto, temFormulario,
} from "../src/shared/doc-forms.js";

test("o PO Box pergunta os dados e os detalhes da caixa", () => {
  const campos = camposDoAcordo("pobox", "pt").map((c) => c.campo);
  assert.ok(campos.includes("nome") && campos.includes("pmb") && campos.includes("vencimento"));
});

test("os campos vêm agrupados em blocos, na ordem", () => {
  const secoes = secoesDoAcordo("pobox", "pt");
  assert.deepEqual(secoes.map((s) => s.id), ["dados", "servico"]);
  assert.ok(secoes[0].campos.length && secoes[1].campos.length);
});

test("rótulos mudam de idioma", () => {
  assert.equal(rotulo("nome", "pt"), "Nome completo");
  assert.equal(rotulo("nome", "en"), "Full legal name");
  assert.equal(rotulo("nome", "es"), "Nombre completo");
});

test("textos da página mudam de idioma", () => {
  assert.match(texto("enviar", "pt"), /Aprovar/);
  assert.match(texto("enviar", "en"), /Approve/);
  assert.match(texto("enviar", "es"), /Aprobar/);
});

test("validar aponta só os obrigatórios em branco", () => {
  const faltando = validar("pobox", { nome: "Ana", endereco: "" }, "pt").map((c) => c.campo);
  assert.ok(faltando.includes("endereco"));
  assert.ok(!faltando.includes("nome"));
  // Os opcionais nunca entram.
  assert.ok(!faltando.includes("pmb"));
});

test("tudo preenchido não falta nada", () => {
  const ok = { nome: "Ana", endereco: "Rua 1", telefone: "555", email: "a@b.com" };
  assert.deepEqual(validar("pobox", ok, "pt"), []);
});

test("telefone e e-mail usam o teclado certo no celular", () => {
  const campos = camposDoAcordo("pobox", "pt");
  assert.equal(campos.find((c) => c.campo === "telefone").tipo, "tel");
  assert.equal(campos.find((c) => c.campo === "email").tipo, "email");
});

test("o divórcio tem formulário nas três línguas; o master não tem campos", () => {
  for (const slug of ["divorce-pt", "divorce-en", "divorce-es"]) {
    assert.ok(temFormulario(slug), slug);
  }
  assert.equal(temFormulario("master"), false);
});

test("a LLC exige o nome da LLC", () => {
  const faltando = validar("llc", {}, "pt").map((c) => c.campo);
  assert.ok(faltando.includes("llcNome"));
});

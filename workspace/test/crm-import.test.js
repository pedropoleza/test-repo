/**
 * Importar os campos personalizados da conta para a ficha do funil.
 *
 * O que precisa valer:
 *
 * 1. Não duplicar o que a ficha já tem — "Telefone" escrito à mão e
 *    "Telefone" do CRM são o mesmo campo, ainda que a chave não bata.
 * 2. Trazer as opções das seleções; sem opção, cair para texto, senão o
 *    campo nasce impossível de preencher.
 * 3. Não importar os campos padrão do contato nem os derivados.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { camposImportaveis, tipoDoCampo, paraCriacao } from "../src/shared/crm-import.js";

const cf = (name, extra = {}) => ({
  key: `cf_${name.toLowerCase().replace(/\W+/g, "")}`, name,
  type: "text", source: "ghl_custom_field", ...extra,
});

test("traz os campos personalizados da conta", () => {
  const colunas = [cf("Data de nascimento", { type: "date" }), cf("Renda mensal", { type: "number" })];
  const out = camposImportaveis(colunas, []);
  assert.deepEqual(out.map((c) => [c.name, c.type]),
    [["Data de nascimento", "date"], ["Renda mensal", "number"]]);
});

test("não importa o que a ficha já tem, mesmo com chave diferente", () => {
  // A database foi montada à mão: a chave dela nunca bate com a do GHL,
  // só o nome. Sem casar por nome, a ficha ganharia dois "Telefone".
  const colunas = [cf("Telefone", { type: "phone" }), cf("Estado", {})];
  const campos = [{ key: "telefone", name: "Telefone", type: "phone" }];
  assert.deepEqual(camposImportaveis(colunas, campos).map((c) => c.name), ["Estado"]);
});

test("o casamento por nome ignora acento, caixa e pontuação", () => {
  const colunas = [cf("Objeções Apresentadas")];
  const campos = [{ key: "obj", name: "objecoes apresentadas" }];
  assert.deepEqual(camposImportaveis(colunas, campos), []);
});

test("campo repetido na conta entra uma vez só", () => {
  const colunas = [cf("Origem"), { ...cf("Origem"), key: "cf_outro" }];
  assert.equal(camposImportaveis(colunas, []).length, 1);
});

test("não importa campo padrão do contato nem derivado", () => {
  // Nome e e-mail a ficha já tem com nomes próprios; "criado em" é
  // derivado da página e não aceita escrita.
  const colunas = [
    { key: "firstName", name: "Nome", type: "text" },
    { key: "c", name: "Criado em", type: "created_time", source: "ghl_custom_field" },
    cf("Perfil do cliente"),
  ];
  assert.deepEqual(camposImportaveis(colunas, []).map((c) => c.name), ["Perfil do cliente"]);
});

test("seleção traz as opções da conta", () => {
  const colunas = [cf("Origem do lead", {
    type: "select",
    options: [{ id: "Indicação", name: "Indicação" }, { id: "Instagram", name: "Instagram" }],
  })];
  const [campo] = camposImportaveis(colunas, []);
  assert.equal(campo.type, "select");
  assert.deepEqual(campo.config.options.map((o) => o.name), ["Indicação", "Instagram"]);
  assert.deepEqual(paraCriacao(campo).type, "select");
});

test("seleção sem opções vira texto, não um campo impreenchível", () => {
  const colunas = [cf("Observação", { type: "select", options: [] })];
  const [campo] = camposImportaveis(colunas, []);
  assert.equal(paraCriacao(campo).type, "text");
});

test("campo somente-leitura do CRM vira texto editável aqui", () => {
  // Upload de arquivo e lista de caixas devolvem uma representação, não
  // o conteúdo. Aqui a pessoa anota o que viu — reproduzir o widget não
  // traria o arquivo junto.
  assert.equal(tipoDoCampo({ type: "multi_select", readOnly: true }), "text");
});

test("conta sem campo personalizado nenhum não quebra", () => {
  assert.deepEqual(camposImportaveis([], []), []);
  assert.deepEqual(camposImportaveis(), []);
});

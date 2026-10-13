/**
 * Criar um funil pela tela.
 *
 * O que precisa valer: sai dali um funil COMPLETO e já utilizável —
 * página, quadro agrupado pelas etapas, ficha com os campos, e o bloco
 * que mostra o quadro. Meio funil é pior que nenhum, porque parece
 * pronto.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace } from "../lib/server/context.js";
import { criarFunil } from "../lib/server/funnel.js";
import { getDatabaseBundle, listViews, listFields } from "../lib/server/databases.js";
import { listBlocks } from "../lib/server/blocks.js";
import { getPage } from "../lib/server/pages.js";
import { campoDeColunas, colunasDoQuadro } from "../src/shared/board-db.js";

async function ctxNovo() {
  __setDbClient(createFakeDb());
  const ws = await ensureWorkspace("loc_A", "user_1");
  return { tenantId: "loc_A", userKey: "user_1", role: "owner", workspaceId: ws.id, workspace: ws };
}

test("o funil nasce completo e já abre como quadro", async () => {
  const ctx = await ctxNovo();
  const { page, databaseId, viewId } = await criarFunil(ctx, {
    nome: "SDR Parcerias",
    etapas: ["Novo lead", "Em contato", "Reunião agendada", "Fechou"],
  });

  const pagina = await getPage(ctx, page.id);
  assert.equal(pagina.title, "SDR Parcerias");
  assert.equal(pagina.layout_width, "full", "um funil de dez colunas não cabe na coluna de leitura");

  const views = await listViews(ctx, databaseId);
  const quadro = views.find((v) => v.id === viewId);
  assert.equal(quadro.type, "board");
  assert.ok(quadro.group_by, "o quadro precisa saber qual campo vira coluna");
  assert.ok(views.some((v) => v.type === "table"), "a tabela fica ao lado");

  // O bloco é o que faz o quadro aparecer na página.
  const blocos = await listBlocks(ctx, page.id);
  const bloco = blocos.find((b) => b.type === "database");
  assert.ok(bloco, "sem o bloco, a página abre vazia");
  assert.equal(bloco.content.databaseId, databaseId);
  assert.equal(bloco.content.viewId, viewId);

  // E as colunas são exatamente as etapas pedidas, na ordem.
  const bundle = await getDatabaseBundle(ctx, databaseId, { viewId });
  const campo = campoDeColunas(bundle.fields, quadro.group_by);
  assert.deepEqual(colunasDoQuadro([], campo).map((c) => c.nome),
    ["Novo lead", "Em contato", "Reunião agendada", "Fechou"]);
});

test("a ficha do funil novo já serve para ligar para alguém", async () => {
  const ctx = await ctxNovo();
  const { databaseId } = await criarFunil(ctx, { nome: "Parcerias" });
  const nomes = (await listFields(ctx, databaseId)).map((f) => f.name);
  for (const esperado of ["Nome completo", "Telefone", "E-mail", "Próxima ação", "Notas"]) {
    assert.ok(nomes.includes(esperado), `faltou ${esperado}`);
  }
  // Os campos padrão da tabela comum (Status, Responsável, Prazo) não
  // entram: num funil a etapa JÁ é o status, e dois status confundem.
  assert.equal(nomes.includes("Status"), false);
  assert.equal(nomes.includes("Prazo"), false);
});

test("funil sem etapas escritas abre com as sugeridas", async () => {
  const ctx = await ctxNovo();
  const { databaseId, viewId } = await criarFunil(ctx, { nome: "Teste" });
  const bundle = await getDatabaseBundle(ctx, databaseId, { viewId });
  const campo = campoDeColunas(bundle.fields, bundle.views.find((v) => v.id === viewId).group_by);
  assert.ok(colunasDoQuadro([], campo).length >= 4, "quadro sem coluna não abre");
});

test("a coluna principal é o nome, e as etapas não viram título", async () => {
  const ctx = await ctxNovo();
  const { databaseId } = await criarFunil(ctx, { nome: "X", etapas: ["A", "B"] });
  const campos = await listFields(ctx, databaseId);
  const principais = campos.filter((f) => f.is_primary);
  assert.equal(principais.length, 1);
  assert.equal(principais[0].name, "Nome completo");
});

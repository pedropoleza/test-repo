/** Seções da sidebar: organização definida pelo usuário. */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import { createPage, movePage, listTree } from "../lib/server/pages.js";
import {
  listSections, createSection, updateSection, deleteSection, moveSection,
} from "../lib/server/sections.js";

async function setup() {
  __setDbClient(createFakeDb());
  const ws = await ensureWorkspace("loc_A", "user_1");
  return { tenantId: "loc_A", userKey: "user_1", role: "owner",
           workspaceId: ws.id, workspace: ws };
}

test("na primeira leitura o workspace ganha Privado (padrão) e Compartilhado", async () => {
  const ctx = await setup();
  const sections = await listSections(ctx);
  assert.deepEqual(sections.map((s) => s.name), ["Privado", "Compartilhado"]);
  assert.equal(sections[0].is_default, true);
  assert.equal(sections.filter((s) => s.is_default).length, 1);
});

test("semear é idempotente", async () => {
  const ctx = await setup();
  const a = await listSections(ctx);
  const b = await listSections(ctx);
  assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id));
});

test("dá para criar, renomear e reordenar seções próprias", async () => {
  const ctx = await setup();
  const ops = await createSection(ctx, { name: "Operações" });
  const fin = await createSection(ctx, { name: "Financeiro" });
  assert.deepEqual((await listSections(ctx)).map((s) => s.name),
    ["Privado", "Compartilhado", "Operações", "Financeiro"]);

  await updateSection(ctx, ops.id, { name: "Operação" });
  await moveSection(ctx, fin.id, { beforeId: ops.id });
  assert.deepEqual((await listSections(ctx)).map((s) => s.name),
    ["Privado", "Compartilhado", "Financeiro", "Operação"]);
});

test("página nasce na seção pedida e pode mudar de seção", async () => {
  const ctx = await setup();
  const vendas = await createSection(ctx, { name: "Vendas" });
  const page = await createPage(ctx, { title: "Playbook", sectionId: vendas.id });
  assert.equal(page.section_id, vendas.id);

  const [privado] = await listSections(ctx);
  const moved = await movePage(ctx, page.id, { parentPageId: null, sectionId: privado.id });
  assert.equal(moved.section_id, privado.id);
});

test("subpágina não carrega seção — ela segue o pai", async () => {
  const ctx = await setup();
  const vendas = await createSection(ctx, { name: "Vendas" });
  const parent = await createPage(ctx, { title: "Raiz", sectionId: vendas.id });
  const child = await createPage(ctx, { title: "Filha", parentPageId: parent.id, sectionId: vendas.id });
  assert.equal(child.section_id, null);

  const promoted = await movePage(ctx, child.id, { parentPageId: null, sectionId: vendas.id });
  assert.equal(promoted.section_id, vendas.id);
  const demoted = await movePage(ctx, promoted.id, { parentPageId: parent.id });
  assert.equal(demoted.section_id, null);
});

test("excluir seção move as páginas para a padrão em vez de apagá-las", async () => {
  const ctx = await setup();
  const temp = await createSection(ctx, { name: "Temporária" });
  const page = await createPage(ctx, { title: "Importante", sectionId: temp.id });

  const { movedTo } = await deleteSection(ctx, temp.id);
  const [padrao] = await listSections(ctx);
  assert.equal(movedTo, padrao.id);

  const tree = await listTree(ctx);
  const still = tree.find((p) => p.id === page.id);
  assert.ok(still, "a página continua existindo");
  assert.equal(still.section_id, padrao.id);
});

test("a seção padrão não pode ser excluída", async () => {
  const ctx = await setup();
  const [padrao] = await listSections(ctx);
  await assert.rejects(
    () => deleteSection(ctx, padrao.id),
    (err) => err instanceof WorkspaceError && err.code === "cannot_delete_default_section",
  );
});

test("seções não vazam entre tenants", async () => {
  const ctxA = await setup();
  const secao = await createSection(ctxA, { name: "Só da A" });

  const wsB = await ensureWorkspace("loc_B", "user_2");
  const ctxB = { tenantId: "loc_B", userKey: "user_2", role: "owner",
                 workspaceId: wsB.id, workspace: wsB };

  const nomesB = (await listSections(ctxB)).map((s) => s.name);
  assert.equal(nomesB.includes("Só da A"), false);
  await assert.rejects(() => updateSection(ctxB, secao.id, { name: "invadido" }),
    (err) => err.code === "section_not_found");
});

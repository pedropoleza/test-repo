/**
 * Fluxos críticos do Workspace Engine (§86, itens das fases 0 e 1).
 * Roda contra o fake in-memory do Supabase — sem rede, sem banco.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/workspace/context.js";
import {
  listTree, getPage, getAncestors, createPage, updatePage, movePage,
  archivePage, duplicatePage, setFavorite, listFavorites,
} from "../lib/server/workspace/pages.js";
import {
  listBlocks, createBlock, updateBlock, moveBlock, deleteBlock, duplicateBlock,
} from "../lib/server/workspace/blocks.js";

async function setup() {
  __setDbClient(createFakeDb());
  const workspace = await ensureWorkspace("loc_A", "user_1");
  return {
    tenantId: "loc_A",
    userKey: "user_1",
    role: "owner",
    workspaceId: workspace.id,
    workspace,
  };
}

const titles = (pages) => pages.map((p) => p.title);

test("ensureWorkspace é idempotente por tenant", async () => {
  const ctx = await setup();
  const again = await ensureWorkspace("loc_A", "user_1");
  assert.equal(again.id, ctx.workspaceId);
});

test("cria página e ela aparece na árvore", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Operações" });
  const tree = await listTree(ctx);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, page.id);
  assert.equal(page.parent_page_id, null);
  assert.ok(page.position);
});

test("cria subpágina e os breadcrumbs sobem até a raiz", async () => {
  const ctx = await setup();
  const parent = await createPage(ctx, { title: "Vendas" });
  const child = await createPage(ctx, { parentPageId: parent.id, title: "Playbook" });
  const grandchild = await createPage(ctx, { parentPageId: child.id, title: "Scripts" });

  assert.equal(child.parent_page_id, parent.id);
  const trail = await getAncestors(ctx, grandchild.id);
  assert.deepEqual(trail.map((c) => c.title), ["Vendas", "Playbook", "Scripts"]);
});

test("páginas irmãs ficam ordenadas por position, não por criação", async () => {
  const ctx = await setup();
  const a = await createPage(ctx, { title: "A" });
  const b = await createPage(ctx, { title: "B" });
  const c = await createPage(ctx, { title: "C", beforeId: a.id });

  assert.deepEqual(titles(await listTree(ctx)), ["C", "A", "B"]);
  assert.ok(c.position < a.position);
  assert.ok(a.position < b.position);
});

test("mover página reordena sem reescrever os irmãos", async () => {
  const ctx = await setup();
  const a = await createPage(ctx, { title: "A" });
  const b = await createPage(ctx, { title: "B" });
  const c = await createPage(ctx, { title: "C" });
  const positionsBefore = { a: a.position, c: c.position };

  await movePage(ctx, b.id, { afterId: c.id });

  assert.deepEqual(titles(await listTree(ctx)), ["A", "C", "B"]);
  const after = await listTree(ctx);
  assert.equal(after.find((p) => p.id === a.id).position, positionsBefore.a);
  assert.equal(after.find((p) => p.id === c.id).position, positionsBefore.c);
});

test("mover página para outro pai transforma em subpágina", async () => {
  const ctx = await setup();
  const parent = await createPage(ctx, { title: "Marketing" });
  const loose = await createPage(ctx, { title: "Campanhas" });

  const moved = await movePage(ctx, loose.id, { parentPageId: parent.id });
  assert.equal(moved.parent_page_id, parent.id);
});

test("mover uma página para dentro da própria subárvore é rejeitado", async () => {
  const ctx = await setup();
  const parent = await createPage(ctx, { title: "Raiz" });
  const child = await createPage(ctx, { parentPageId: parent.id, title: "Filha" });

  await assert.rejects(
    () => movePage(ctx, parent.id, { parentPageId: child.id }),
    (err) => err instanceof WorkspaceError && err.code === "cannot_move_into_descendant",
  );
});

test("remover a capa limpa tipo e valor juntos", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Com capa" });
  await updatePage(ctx, page.id, { cover_type: "gradient", cover_value: "midnight" });
  const cleared = await updatePage(ctx, page.id, { cover_type: null });

  assert.equal(cleared.cover_type, null);
  assert.equal(cleared.cover_value, null);
});

test("arquivar leva a subárvore inteira para a lixeira e restaurar traz a raiz de volta", async () => {
  const ctx = await setup();
  const parent = await createPage(ctx, { title: "Projeto" });
  const child = await createPage(ctx, { parentPageId: parent.id, title: "Tarefas" });

  const { ids } = await archivePage(ctx, parent.id, true);
  assert.equal(ids.length, 2);
  assert.deepEqual(await listTree(ctx), []);
  assert.equal((await getPage(ctx, child.id)).is_archived, true);

  await archivePage(ctx, parent.id, false);
  assert.deepEqual(titles(await listTree(ctx)), ["Projeto"]);
});

test("duplicar copia subpáginas e blocos, e a cópia não herda vínculo externo", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "SOP" });
  await createBlock(ctx, { pageId: page.id, type: "heading1", content: { rich: [{ s: "Passo 1" }] } });
  await createBlock(ctx, { pageId: page.id, type: "paragraph", content: { rich: [{ s: "Detalhe" }] } });
  const child = await createPage(ctx, { parentPageId: page.id, title: "Anexos" });
  await createBlock(ctx, { pageId: child.id, type: "paragraph", content: { rich: [{ s: "Nota" }] } });

  const copy = await duplicatePage(ctx, page.id);

  assert.equal(copy.title, "SOP (cópia)");
  assert.equal(copy.source, "native");
  const copyBlocks = await listBlocks(ctx, copy.id);
  assert.deepEqual(copyBlocks.map((b) => b.type), ["heading1", "paragraph"]);

  const tree = await listTree(ctx);
  const copiedChild = tree.find((p) => p.parent_page_id === copy.id);
  assert.equal(copiedChild.title, "Anexos");
  assert.equal((await listBlocks(ctx, copiedChild.id)).length, 1);
  // O original continua intacto.
  assert.equal((await listBlocks(ctx, page.id)).length, 2);
});

test("favoritar e desfavoritar não duplica a linha", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Fav" });

  await setFavorite(ctx, page.id, true);
  await setFavorite(ctx, page.id, true);
  assert.equal((await listFavorites(ctx)).length, 1);

  await setFavorite(ctx, page.id, false);
  assert.equal((await listFavorites(ctx)).length, 0);
});

/* ------------------------------- blocos ------------------------------- */

test("cria blocos e eles saem ordenados", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Doc" });
  const first = await createBlock(ctx, { pageId: page.id, type: "paragraph", content: { rich: [{ s: "um" }] } });
  const second = await createBlock(ctx, { pageId: page.id, type: "paragraph", afterId: first.id, content: { rich: [{ s: "dois" }] } });

  const blocks = await listBlocks(ctx, page.id);
  assert.deepEqual(blocks.map((b) => b.id), [first.id, second.id]);
  assert.deepEqual(blocks.map((b) => b.content.rich[0].s), ["um", "dois"]);
  assert.ok(first.position < second.position);
});

test("reordenar bloco mexe só na linha movida", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Doc" });
  const a = await createBlock(ctx, { pageId: page.id, type: "paragraph" });
  const b = await createBlock(ctx, { pageId: page.id, type: "paragraph" });
  const c = await createBlock(ctx, { pageId: page.id, type: "paragraph" });

  await moveBlock(ctx, c.id, { beforeId: a.id });

  const order = (await listBlocks(ctx, page.id)).map((x) => x.id);
  assert.deepEqual(order, [c.id, a.id, b.id]);
  const current = await listBlocks(ctx, page.id);
  assert.equal(current.find((x) => x.id === a.id).position, a.position);
  assert.equal(current.find((x) => x.id === b.id).position, b.position);
});

test("aninhar bloco exige um pai que aceite filhos", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Doc" });
  const toggle = await createBlock(ctx, { pageId: page.id, type: "toggle" });
  const paragraph = await createBlock(ctx, { pageId: page.id, type: "paragraph" });
  const quote = await createBlock(ctx, { pageId: page.id, type: "quote" });

  const nested = await moveBlock(ctx, paragraph.id, { parentBlockId: toggle.id });
  assert.equal(nested.parent_block_id, toggle.id);

  await assert.rejects(
    () => moveBlock(ctx, nested.id, { parentBlockId: quote.id }),
    (err) => err.code === "parent_block_cannot_nest",
  );
});

test("turn into preserva o texto do bloco", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Doc" });
  const block = await createBlock(ctx, {
    pageId: page.id,
    type: "paragraph",
    content: { rich: [{ s: "Título virado" }] },
  });

  const converted = await updateBlock(ctx, block.id, { type: "heading2" });
  assert.equal(converted.type, "heading2");
  assert.deepEqual(converted.content.rich, [{ s: "Título virado" }]);
});

test("tipo de bloco desconhecido vira unsupported guardando o original", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Import" });
  const block = await createBlock(ctx, {
    pageId: page.id,
    type: "notion:synced_block",
    content: { foo: "bar" },
  });

  assert.equal(block.type, "unsupported");
  assert.equal(block.content.originalType, "notion:synced_block");
  assert.deepEqual(block.content.originalPayload, { foo: "bar" });
});

test("excluir bloco pai leva os filhos junto", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Doc" });
  const toggle = await createBlock(ctx, { pageId: page.id, type: "toggle" });
  await createBlock(ctx, { pageId: page.id, type: "paragraph", parentBlockId: toggle.id });

  await deleteBlock(ctx, toggle.id);
  assert.equal((await listBlocks(ctx, page.id)).length, 0);
});

test("bloco aceita id gerado pelo cliente e ignora id inválido", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Doc" });
  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  const withId = await createBlock(ctx, { id, pageId: page.id, type: "paragraph" });
  assert.equal(withId.id, id);

  const withJunk = await createBlock(ctx, { id: "'; drop table --", pageId: page.id, type: "paragraph" });
  assert.notEqual(withJunk.id, "'; drop table --");
  assert.match(withJunk.id, /^[0-9a-f-]{36}$/);
});

test("duplicar bloco insere logo depois do original", async () => {
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Doc" });
  const a = await createBlock(ctx, { pageId: page.id, type: "paragraph", content: { rich: [{ s: "x" }] } });
  const b = await createBlock(ctx, { pageId: page.id, type: "paragraph" });

  const copy = await duplicateBlock(ctx, a.id);
  const order = (await listBlocks(ctx, page.id)).map((x) => x.id);
  assert.deepEqual(order, [a.id, copy.id, b.id]);
  assert.deepEqual(copy.content.rich, [{ s: "x" }]);
});

/* ----------------------------- multi-tenancy ---------------------------- */

test("outro tenant não enxerga a página nem pelo id", async () => {
  const ctxA = await setup();
  const page = await createPage(ctxA, { title: "Confidencial" });

  const workspaceB = await ensureWorkspace("loc_B", "user_2");
  const ctxB = {
    tenantId: "loc_B",
    userKey: "user_2",
    role: "owner",
    workspaceId: workspaceB.id,
    workspace: workspaceB,
  };

  assert.notEqual(ctxB.workspaceId, ctxA.workspaceId);
  await assert.rejects(
    () => getPage(ctxB, page.id),
    (err) => err instanceof WorkspaceError && err.code === "page_not_found",
  );
  assert.deepEqual(await listTree(ctxB), []);
  await assert.rejects(
    () => createBlock(ctxB, { pageId: page.id, type: "paragraph" }),
    (err) => err.code === "page_not_found",
  );
});

/**
 * Comentários da ficha.
 *
 * Presos ao contato e ao tenant; exclusão é lógica (some do fio, fica no
 * banco); e as @menções são resolvidas no servidor a partir da equipe,
 * não do que o cliente mandaria.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import { listComments, addComment, deleteComment } from "../lib/server/comments.js";

const EQUIPE = [
  { id: "u1", name: "Samantha" },
  { id: "u2", name: "Ana" },
];

async function setup(tenant = "loc_A") {
  __setDbClient(createFakeDb());
  const ws = await ensureWorkspace(tenant, "user_1");
  return { tenantId: tenant, userKey: "user_1", role: "owner", workspaceId: ws.id };
}

test("grava e lê um comentário", async () => {
  const ctx = await setup();
  const c = await addComment(ctx, { contactId: "c1", body: "faltou o RG", author: "Sam", usuarios: EQUIPE });
  assert.equal(c.body, "faltou o RG");
  assert.equal(c.author, "Sam");
  const lista = await listComments(ctx, "c1");
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, c.id);
});

test("resolve as @menções no servidor", async () => {
  const ctx = await setup();
  const c = await addComment(ctx, { contactId: "c1", body: "@Samantha confere @Ana", author: "Bot", usuarios: EQUIPE });
  assert.deepEqual([...c.mentions].sort(), ["u1", "u2"]);
});

test("corpo vazio é recusado", async () => {
  const ctx = await setup();
  await assert.rejects(() => addComment(ctx, { contactId: "c1", body: "   ", author: "Sam" }),
    (e) => e instanceof WorkspaceError && e.code === "empty_comment");
});

test("sem contato é recusado", async () => {
  const ctx = await setup();
  await assert.rejects(() => addComment(ctx, { body: "oi", author: "Sam" }),
    (e) => e instanceof WorkspaceError && e.code === "missing_field");
});

test("exclusão lógica tira do fio", async () => {
  const ctx = await setup();
  const c = await addComment(ctx, { contactId: "c1", body: "some", author: "Sam", usuarios: EQUIPE });
  await deleteComment(ctx, c.id);
  assert.equal((await listComments(ctx, "c1")).length, 0);
});

test("um tenant não vê o comentário do outro", async () => {
  const ctxA = await setup("loc_A");
  await addComment(ctxA, { contactId: "c1", body: "de A", author: "Sam", usuarios: EQUIPE });
  // Mesmo fake-db, outro workspace: some da leitura do outro tenant.
  const wsB = await ensureWorkspace("loc_B", "user_2");
  const ctxB = { tenantId: "loc_B", userKey: "user_2", role: "owner", workspaceId: wsB.id };
  assert.equal((await listComments(ctxB, "c1")).length, 0);
});

test("ordena do mais antigo ao mais novo", async () => {
  const ctx = await setup();
  await addComment(ctx, { contactId: "c1", body: "primeiro", author: "Sam", usuarios: EQUIPE });
  await addComment(ctx, { contactId: "c1", body: "segundo", author: "Sam", usuarios: EQUIPE });
  const lista = await listComments(ctx, "c1");
  assert.deepEqual(lista.map((c) => c.body), ["primeiro", "segundo"]);
});

/**
 * Documentos do cliente na ficha (F2).
 *
 * O que precisa valer: os arquivos de um contato ficam presos ao contato
 * e ao tenant. Listar traz só os dele; remover exige que o arquivo seja
 * deste workspace — o tenant vem do token, nunca do corpo.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient, db } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import { listContactDocuments, deleteContactDocument } from "../lib/server/contact-documents.js";
import { CATEGORIAS, normalizarCategoria, nomeDaCategoria } from "../src/shared/documents.js";

async function setup(tenant = "loc_A") {
  __setDbClient(createFakeDb());
  const ws = await ensureWorkspace(tenant, "user_1");
  return { tenantId: tenant, userKey: "user_1", role: "owner", workspaceId: ws.id };
}

async function anexar(ctx, contactId, categoria, nome) {
  const { data } = await db().from("workspace_files").insert({
    workspace_id: ctx.workspaceId,
    storage_key: `${ctx.workspaceId}/${nome}`,
    public_url: `https://fake/${nome}`,
    original_name: nome,
    mime_type: "application/pdf",
    byte_size: 100,
    source: "contact_doc",
    source_external_id: contactId,
    category: categoria,
  }).select("id").maybeSingle();
  return data.id;
}

/* ---------------- categorias ---------------- */

test("a categoria inválida cai num padrão seguro", () => {
  assert.equal(normalizarCategoria("recibo"), "recibo");
  assert.equal(normalizarCategoria("inventada"), "recebido");
  assert.equal(normalizarCategoria(undefined), "recebido");
  assert.equal(nomeDaCategoria("contrato"), "Contratos assinados");
  assert.ok(CATEGORIAS.length >= 4);
});

/* ---------------- listar ---------------- */

test("lista só os documentos daquele contato", async () => {
  const ctx = await setup();
  await anexar(ctx, "c1", "recebido", "passaporte.pdf");
  await anexar(ctx, "c1", "contrato", "contrato.pdf");
  await anexar(ctx, "c2", "recibo", "recibo-outro.pdf");

  const docs = await listContactDocuments(ctx, "c1");
  assert.equal(docs.length, 2);
  assert.deepEqual(docs.map((d) => d.nome).sort(), ["contrato.pdf", "passaporte.pdf"]);
  assert.ok(docs.every((d) => d.url && d.categoria));
});

test("contato sem documentos devolve lista vazia", async () => {
  const ctx = await setup();
  assert.deepEqual(await listContactDocuments(ctx, "vazio"), []);
});

test("sem contato, recusa", async () => {
  const ctx = await setup();
  await assert.rejects(() => listContactDocuments(ctx),
    (e) => e instanceof WorkspaceError && e.status === 400);
});

/* ---------------- remover ---------------- */

test("remove um documento do próprio workspace", async () => {
  const ctx = await setup();
  const id = await anexar(ctx, "c1", "recebido", "doc.pdf");
  await deleteContactDocument(ctx, id);
  assert.deepEqual(await listContactDocuments(ctx, "c1"), []);
});

test("não remove documento de outro tenant", async () => {
  // O isolamento é a regra: o id de um arquivo de outra conta não pode
  // ser apagado passando pelo workspace deste.
  const a = await setup("loc_A");
  const id = await anexar(a, "c1", "recebido", "doc.pdf");

  __setDbClient(db());               // mesmo fake, outro workspace
  const b = await ensureWorkspace("loc_B", "user_2");
  const ctxB = { tenantId: "loc_B", userKey: "user_2", role: "owner", workspaceId: b.id };
  await assert.rejects(() => deleteContactDocument(ctxB, id),
    (e) => e instanceof WorkspaceError && e.status === 404);
});

/**
 * Checklist de documentos por serviço.
 *
 * O estado de cada documento fica preso ao contato, ao serviço e ao
 * tenant. Voltar para "pendente" apaga a linha — o padrão não ocupa
 * espaço, e "o que falta" continua sendo só o que tem linha diferente
 * de pendente.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import { listChecklist, setChecklistItem } from "../lib/server/doc-checklist.js";
import { proximoEstadoDoc, ESTADOS_DOC, estadoDocValido } from "../src/shared/documents.js";

async function setup(tenant = "loc_A") {
  __setDbClient(createFakeDb());
  const ws = await ensureWorkspace(tenant, "user_1");
  return { tenantId: tenant, userKey: "user_1", role: "owner", workspaceId: ws.id };
}

/* ---------------- estados ---------------- */

test("os estados avançam em ciclo", () => {
  assert.equal(proximoEstadoDoc("pendente"), "recebido");
  assert.equal(proximoEstadoDoc("recebido"), "enviado");
  assert.equal(proximoEstadoDoc("enviado"), "devolvido");
  assert.equal(proximoEstadoDoc("devolvido"), "pendente");
  assert.ok(estadoDocValido("recebido"));
  assert.ok(!estadoDocValido("qualquer"));
  assert.equal(ESTADOS_DOC.length, 4);
});

/* ---------------- gravar e ler ---------------- */

test("grava o estado e lê de volta", async () => {
  const ctx = await setup();
  await setChecklistItem(ctx, { contactId: "c1", serviceCode: "pobox", item: "USPS Form 1583", state: "recebido" });
  const mapa = await listChecklist(ctx, "c1");
  assert.equal(mapa["pobox|USPS Form 1583"], "recebido");
});

test("voltar para pendente apaga a linha", async () => {
  const ctx = await setup();
  await setChecklistItem(ctx, { contactId: "c1", serviceCode: "pobox", item: "ID", state: "enviado" });
  assert.equal((await listChecklist(ctx, "c1"))["pobox|ID"], "enviado");
  await setChecklistItem(ctx, { contactId: "c1", serviceCode: "pobox", item: "ID", state: "pendente" });
  assert.equal((await listChecklist(ctx, "c1"))["pobox|ID"], undefined);
});

test("regravar o mesmo item não duplica", async () => {
  const ctx = await setup();
  await setChecklistItem(ctx, { contactId: "c1", serviceCode: "pobox", item: "ID", state: "recebido" });
  await setChecklistItem(ctx, { contactId: "c1", serviceCode: "pobox", item: "ID", state: "enviado" });
  const mapa = await listChecklist(ctx, "c1");
  assert.equal(mapa["pobox|ID"], "enviado");
  assert.equal(Object.keys(mapa).length, 1);
});

test("estados de contatos e serviços diferentes não se misturam", async () => {
  const ctx = await setup();
  await setChecklistItem(ctx, { contactId: "c1", serviceCode: "pobox", item: "ID", state: "recebido" });
  await setChecklistItem(ctx, { contactId: "c1", serviceCode: "llc", item: "ID", state: "enviado" });
  await setChecklistItem(ctx, { contactId: "c2", serviceCode: "pobox", item: "ID", state: "devolvido" });
  const c1 = await listChecklist(ctx, "c1");
  assert.equal(c1["pobox|ID"], "recebido");
  assert.equal(c1["llc|ID"], "enviado");
  assert.equal(Object.keys(c1).length, 2);
  assert.equal((await listChecklist(ctx, "c2"))["pobox|ID"], "devolvido");
});

/* ---------------- validação ---------------- */

test("estado inválido é recusado", async () => {
  const ctx = await setup();
  await assert.rejects(
    () => setChecklistItem(ctx, { contactId: "c1", serviceCode: "pobox", item: "ID", state: "sei_la" }),
    (e) => e instanceof WorkspaceError && e.code === "estado_invalido");
});

test("campo faltando é recusado", async () => {
  const ctx = await setup();
  await assert.rejects(
    () => setChecklistItem(ctx, { contactId: "c1", item: "ID", state: "recebido" }),
    (e) => e instanceof WorkspaceError && e.status === 400);
});

test("contato sem checklist devolve mapa vazio", async () => {
  const ctx = await setup();
  assert.deepEqual(await listChecklist(ctx, "vazio"), {});
});

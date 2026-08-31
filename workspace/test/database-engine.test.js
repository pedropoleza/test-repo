/**
 * Database engine (§16–22): campos, registros, views, filtros, sorts e
 * agrupamento — mais o critério de aceitação §88.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import { createPage, listTree, getPage } from "../lib/server/pages.js";
import {
  createDatabase, getDatabaseBundle, listFields, listViews, listRecords,
  createField, updateField, deleteField, moveField,
  createView, updateView, deleteView,
  createRecord, updateRecord, deleteRecord, moveRecord, deleteDatabase,
} from "../lib/server/databases.js";
import { groupRecords, readValue } from "../src/shared/fields.js";

async function setup() {
  __setDbClient(createFakeDb());
  const ws = await ensureWorkspace("loc_A", "user_1");
  const ctx = { tenantId: "loc_A", userKey: "user_1", role: "owner",
                workspaceId: ws.id, workspace: ws };
  const page = await createPage(ctx, { title: "Projetos" });
  const database = await createDatabase(ctx, { pageId: page.id, title: "Tarefas" });
  return { ctx, page, database };
}

const keyOf = (fields, name) => fields.find((f) => f.name === name).key;

test("database nasce utilizável: campos padrão e uma view de tabela", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const views = await listViews(ctx, database.id);

  assert.deepEqual(fields.map((f) => f.name), ["Nome", "Status", "Responsável", "Prazo"]);
  assert.equal(fields[0].is_primary, true);
  assert.equal(views.length, 1);
  assert.equal(views[0].type, "table");
  assert.equal(fields.find((f) => f.type === "status").config.options.length, 3);
});

test("registro é uma página — abre como página completa", async () => {
  const { ctx, database } = await setup();
  const rec = await createRecord(ctx, database.id, { title: "Escrever proposta" });
  const asPage = await getPage(ctx, rec.id);
  assert.equal(asPage.id, rec.id);
  assert.equal(asPage.database_id, database.id);
  assert.equal(asPage.title, "Escrever proposta");
});

test("registros não poluem a árvore da sidebar", async () => {
  const { ctx, database } = await setup();
  for (const t of ["A", "B", "C"]) await createRecord(ctx, database.id, { title: t });
  const tree = await listTree(ctx);
  assert.deepEqual(tree.map((p) => p.title), ["Projetos"]);
});

test("valores são coagidos ao tipo do campo e chaves desconhecidas caem fora", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const num = await createField(ctx, database.id, { name: "Orçamento", type: "number" });
  const chk = await createField(ctx, database.id, { name: "Urgente", type: "checkbox" });

  const rec = await createRecord(ctx, database.id, {
    title: "X",
    properties: {
      [num.key]: "1.234,5",
      [chk.key]: "true",
      [keyOf(fields, "Status")]: "doing",
      campo_inexistente: "deveria sumir",
    },
  });
  assert.equal(rec.properties[num.key], 1234.5);
  assert.equal(rec.properties[chk.key], true);
  assert.equal(rec.properties[keyOf(fields, "Status")], "doing");
  assert.equal(rec.properties.campo_inexistente, undefined);
});

test("opção de select inexistente é recusada em vez de gravar lixo", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const rec = await createRecord(ctx, database.id, {
    properties: { [keyOf(fields, "Status")]: "nao_existe" },
  });
  assert.equal(rec.properties[keyOf(fields, "Status")], null);
});

test("atualizar registro faz merge — mandar uma célula não apaga as outras", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const rec = await createRecord(ctx, database.id, {
    title: "Y",
    properties: { [keyOf(fields, "Status")]: "todo", [keyOf(fields, "Responsável")]: "Ana" },
  });
  const upd = await updateRecord(ctx, rec.id, {
    properties: { [keyOf(fields, "Status")]: "done" },
  });
  assert.equal(upd.properties[keyOf(fields, "Status")], "done");
  assert.equal(upd.properties[keyOf(fields, "Responsável")], "Ana");
});

test("renomear campo não move os dados; apagar não os destrói", async () => {
  const { ctx, database } = await setup();
  const field = await createField(ctx, database.id, { name: "Notas", type: "text" });
  const rec = await createRecord(ctx, database.id, { properties: { [field.key]: "importante" } });

  const renamed = await updateField(ctx, field.id, { name: "Observações" });
  assert.equal(renamed.key, field.key, "a key precisa ser estável");
  assert.equal((await listRecords(ctx, database.id))[0].properties[field.key], "importante");

  await deleteField(ctx, field.id);
  const after = (await listRecords(ctx, database.id)).find((r) => r.id === rec.id);
  assert.equal(after.properties[field.key], "importante", "valor sobrevive à coluna");
});

test("o campo primário não pode ser apagado", async () => {
  const { ctx, database } = await setup();
  const primary = (await listFields(ctx, database.id)).find((f) => f.is_primary);
  await assert.rejects(
    () => deleteField(ctx, primary.id),
    (err) => err instanceof WorkspaceError && err.code === "cannot_delete_primary_field",
  );
});

test("reordenar coluna mexe só na coluna movida", async () => {
  const { ctx, database } = await setup();
  const before = await listFields(ctx, database.id);
  await moveField(ctx, before[3].id, { beforeId: before[1].id });
  const after = await listFields(ctx, database.id);
  assert.deepEqual(after.map((f) => f.name), ["Nome", "Prazo", "Status", "Responsável"]);
  assert.equal(after.find((f) => f.name === "Status").position, before[1].position);
});

test("filtro com AND e OR aninhados", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const status = keyOf(fields, "Status");
  const dono = keyOf(fields, "Responsável");

  await createRecord(ctx, database.id, { title: "1", properties: { [status]: "doing", [dono]: "Ana" } });
  await createRecord(ctx, database.id, { title: "2", properties: { [status]: "done",  [dono]: "Ana" } });
  await createRecord(ctx, database.id, { title: "3", properties: { [status]: "doing", [dono]: "Bruno" } });

  const view = (await listViews(ctx, database.id))[0];
  await updateView(ctx, view.id, {
    filters: { op: "and", conditions: [
      { field: dono, operator: "equals", value: "Ana" },
      { op: "or", conditions: [
        { field: status, operator: "equals", value: "doing" },
        { field: status, operator: "equals", value: "done" },
      ] },
    ] },
  });

  const bundle = await getDatabaseBundle(ctx, database.id);
  assert.deepEqual(bundle.records.map((r) => r.title).sort(), ["1", "2"]);
  assert.equal(bundle.totalRecords, 3, "totalRecords ignora o filtro");
});

test("filtro sobre campo apagado deixa de filtrar em vez de zerar a tabela", async () => {
  const { ctx, database } = await setup();
  const extra = await createField(ctx, database.id, { name: "Temp", type: "text" });
  await createRecord(ctx, database.id, { title: "A" });
  const view = (await listViews(ctx, database.id))[0];
  await updateView(ctx, view.id, {
    filters: { op: "and", conditions: [{ field: extra.key, operator: "equals", value: "zzz" }] },
  });
  await deleteField(ctx, extra.id);

  const bundle = await getDatabaseBundle(ctx, database.id);
  assert.equal(bundle.records.length, 1);
});

test("ordenação múltipla, com vazios sempre no fim", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const prazo = keyOf(fields, "Prazo");
  const dono = keyOf(fields, "Responsável");

  await createRecord(ctx, database.id, { title: "sem prazo", properties: { [dono]: "Ana" } });
  await createRecord(ctx, database.id, { title: "tarde", properties: { [prazo]: "2026-12-01", [dono]: "Ana" } });
  await createRecord(ctx, database.id, { title: "cedo",  properties: { [prazo]: "2026-01-05", [dono]: "Ana" } });

  const view = (await listViews(ctx, database.id))[0];
  await updateView(ctx, view.id, { sorts: [{ field: prazo, direction: "asc" }] });
  let bundle = await getDatabaseBundle(ctx, database.id);
  assert.deepEqual(bundle.records.map((r) => r.title), ["cedo", "tarde", "sem prazo"]);

  await updateView(ctx, view.id, { sorts: [{ field: prazo, direction: "desc" }] });
  bundle = await getDatabaseBundle(ctx, database.id);
  assert.deepEqual(bundle.records.map((r) => r.title), ["tarde", "cedo", "sem prazo"]);
});

test("agrupamento segue a ordem das opções e junta os vazios", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const status = fields.find((f) => f.type === "status");

  await createRecord(ctx, database.id, { title: "a", properties: { [status.key]: "done" } });
  await createRecord(ctx, database.id, { title: "b", properties: { [status.key]: "todo" } });
  await createRecord(ctx, database.id, { title: "c" });

  const records = await listRecords(ctx, database.id);
  const groups = groupRecords(records, status);
  assert.deepEqual(groups.map((g) => g.label), ["A fazer", "Concluído", "Sem valor"]);
  assert.deepEqual(groups.map((g) => g.records.length), [1, 1, 1]);
});

test("campos derivados são lidos da página e nunca gravados", async () => {
  const { ctx, database } = await setup();
  const criado = await createField(ctx, database.id, { name: "Criado", type: "created_time" });
  const rec = await createRecord(ctx, database.id, {
    title: "z", properties: { [criado.key]: "1999-01-01" },
  });
  assert.equal(criado.key in rec.properties, false, "não grava");
  assert.equal(readValue(criado, rec), rec.created_at, "lê da página");
});

test("várias views sobre a mesma fonte, sem duplicar registro", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const status = keyOf(fields, "Status");
  await createRecord(ctx, database.id, { title: "1", properties: { [status]: "todo" } });
  await createRecord(ctx, database.id, { title: "2", properties: { [status]: "done" } });

  const board = await createView(ctx, database.id, { type: "board", name: "Quadro", groupBy: status });
  await updateView(ctx, board.id, {
    filters: { op: "and", conditions: [{ field: status, operator: "equals", value: "done" }] },
  });

  const tabela = await getDatabaseBundle(ctx, database.id, { viewId: (await listViews(ctx, database.id))[0].id });
  const quadro = await getDatabaseBundle(ctx, database.id, { viewId: board.id });

  assert.equal(tabela.records.length, 2);
  assert.equal(quadro.records.length, 1);
  assert.equal(await listRecords(ctx, database.id).then((r) => r.length), 2, "a fonte não mudou");
});

test("a última view não pode ser apagada", async () => {
  const { ctx, database } = await setup();
  const view = (await listViews(ctx, database.id))[0];
  await assert.rejects(
    () => deleteView(ctx, view.id),
    (err) => err.code === "cannot_delete_last_view",
  );
});

test("apagar a database leva campos, views e registros junto", async () => {
  const { ctx, database } = await setup();
  await createRecord(ctx, database.id, { title: "some" });
  await deleteDatabase(ctx, database.id);

  assert.deepEqual(await listFields(ctx, database.id), []);
  assert.deepEqual(await listViews(ctx, database.id), []);
  assert.deepEqual(await listRecords(ctx, database.id), []);
  await assert.rejects(() => getDatabaseBundle(ctx, database.id),
    (err) => err.code === "database_not_found");
});

test("outro tenant não alcança a database nem seus registros", async () => {
  const { ctx, database } = await setup();
  const rec = await createRecord(ctx, database.id, { title: "confidencial" });
  const wsB = await ensureWorkspace("loc_B", "user_2");
  const ctxB = { tenantId: "loc_B", userKey: "user_2", role: "owner",
                 workspaceId: wsB.id, workspace: wsB };

  await assert.rejects(() => getDatabaseBundle(ctxB, database.id),
    (err) => err.code === "database_not_found");
  await assert.rejects(() => updateRecord(ctxB, rec.id, { title: "invadido" }),
    (err) => err.code === "record_not_found");
  await assert.rejects(() => deleteRecord(ctxB, rec.id),
    (err) => err.code === "record_not_found");
});

test("reordenar registro preserva a posição dos vizinhos", async () => {
  const { ctx, database } = await setup();
  const a = await createRecord(ctx, database.id, { title: "a" });
  const b = await createRecord(ctx, database.id, { title: "b" });
  const c = await createRecord(ctx, database.id, { title: "c" });
  await moveRecord(ctx, c.id, { beforeId: a.id });

  const order = (await listRecords(ctx, database.id)).map((r) => r.title);
  assert.deepEqual(order, ["c", "a", "b"]);
  const now = await listRecords(ctx, database.id);
  assert.equal(now.find((r) => r.id === b.id).position, b.position);
});

test("a coluna principal é o título da página, não uma propriedade solta", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const nome = fields.find((f) => f.is_primary);

  const rec = await createRecord(ctx, database.id, {
    properties: { [nome.key]: "Proposta ACME" },
  });
  assert.equal(rec.title, "Proposta ACME", "vai para o título da página");
  assert.equal(nome.key in rec.properties, false, "não duplica em properties");
  assert.equal(readValue(nome, rec), "Proposta ACME", "a tabela lê do título");

  const upd = await updateRecord(ctx, rec.id, { properties: { [nome.key]: "Proposta Beta" } });
  assert.equal(upd.title, "Proposta Beta");

  // e o caminho inverso: renomear a página muda a célula da tabela
  const viaTitulo = await updateRecord(ctx, rec.id, { title: "Renomeado na página" });
  assert.equal(readValue(nome, viaTitulo), "Renomeado na página");
});

test("ordenar pela coluna principal usa o título", async () => {
  const { ctx, database } = await setup();
  const fields = await listFields(ctx, database.id);
  const nome = fields.find((f) => f.is_primary);
  for (const t of ["Zebra", "Alfa", "Meio"]) {
    await createRecord(ctx, database.id, { properties: { [nome.key]: t } });
  }
  const view = (await listViews(ctx, database.id))[0];
  await updateView(ctx, view.id, { sorts: [{ field: nome.key, direction: "asc" }] });
  const bundle = await getDatabaseBundle(ctx, database.id);
  assert.deepEqual(bundle.records.map((r) => r.title), ["Alfa", "Meio", "Zebra"]);
});

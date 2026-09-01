/**
 * Associações entre contatos.
 *
 * O que precisa valer: o vínculo existe nos DOIS lados com o rótulo
 * invertido. Um par assimétrico é pior que a ausência dele — ninguém
 * procura o erro no lado que não mostra nada.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import { listRelations, linkContacts, unlinkContacts } from "../lib/server/relations.js";
import {
  RELATIONS, inverseRelation, relationName, groupRelations, isRelation,
} from "../src/shared/relations.js";

async function setup(tenant = "loc_A") {
  __setDbClient(createFakeDb());
  const ws = await ensureWorkspace(tenant, "user_1");
  return { tenantId: tenant, userKey: "user_1", role: "owner", workspaceId: ws.id };
}

/* ---------------- a tabela de parentescos ---------------- */

test("todo parentesco tem inverso, e o inverso do inverso volta", () => {
  for (const rel of RELATIONS) {
    const inv = inverseRelation(rel.id);
    assert.ok(isRelation(inv), `${rel.id} aponta para "${inv}", que não existe`);
    assert.equal(inverseRelation(inv), rel.id,
      `${rel.id} → ${inv} → ${inverseRelation(inv)}: a volta não fecha`);
  }
});

test("os simétricos são o próprio inverso", () => {
  for (const id of ["conjuge", "irmao", "primo", "socio", "outro"]) {
    assert.equal(inverseRelation(id), id);
  }
});

test("filho e pai/mãe se invertem", () => {
  assert.equal(inverseRelation("filho"), "pai_mae");
  assert.equal(inverseRelation("pai_mae"), "filho");
});

test("rótulo desconhecido não quebra a tela", () => {
  assert.equal(relationName("inventado"), "Vínculo");
  assert.equal(inverseRelation("inventado"), "outro");
});

/* ---------------- gravação nos dois sentidos ---------------- */

test("marcar um filho grava o pai do outro lado", async () => {
  const ctx = await setup();
  await linkContacts(ctx, { contactId: "maria", relatedContactId: "joao", relation: "filho" });

  const deMaria = await listRelations(ctx, "maria");
  assert.equal(deMaria.length, 1);
  assert.equal(deMaria[0].related_contact_id, "joao");
  assert.equal(deMaria[0].relation, "filho", "João é filho de Maria");

  const deJoao = await listRelations(ctx, "joao");
  assert.equal(deJoao.length, 1);
  assert.equal(deJoao[0].related_contact_id, "maria");
  assert.equal(deJoao[0].relation, "pai_mae", "Maria é pai/mãe de João");
});

test("remarcar o mesmo par troca o rótulo, não duplica", async () => {
  const ctx = await setup();
  await linkContacts(ctx, { contactId: "a", relatedContactId: "b", relation: "filho" });
  await linkContacts(ctx, { contactId: "a", relatedContactId: "b", relation: "conjuge" });

  const deA = await listRelations(ctx, "a");
  assert.equal(deA.length, 1, "duplicou o vínculo");
  assert.equal(deA[0].relation, "conjuge");
  assert.equal((await listRelations(ctx, "b"))[0].relation, "conjuge");
});

test("desfazer some dos dois lados", async () => {
  const ctx = await setup();
  await linkContacts(ctx, { contactId: "a", relatedContactId: "b", relation: "irmao" });
  await unlinkContacts(ctx, { contactId: "a", relatedContactId: "b" });
  assert.deepEqual(await listRelations(ctx, "a"), []);
  assert.deepEqual(await listRelations(ctx, "b"), [], "sobrou o vínculo do outro lado");
});

test("desfazer um vínculo não derruba os outros", async () => {
  const ctx = await setup();
  await linkContacts(ctx, { contactId: "pai", relatedContactId: "f1", relation: "filho" });
  await linkContacts(ctx, { contactId: "pai", relatedContactId: "f2", relation: "filho" });
  await unlinkContacts(ctx, { contactId: "pai", relatedContactId: "f1" });

  const restantes = await listRelations(ctx, "pai");
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].related_contact_id, "f2");
});

test("ninguém é parente de si mesmo", async () => {
  const ctx = await setup();
  await assert.rejects(
    () => linkContacts(ctx, { contactId: "a", relatedContactId: "a", relation: "filho" }),
    (e) => e instanceof WorkspaceError && e.code === "mesmo_contato");
});

test("parentesco inventado é recusado", async () => {
  const ctx = await setup();
  await assert.rejects(
    () => linkContacts(ctx, { contactId: "a", relatedContactId: "b", relation: "xpto" }),
    (e) => e instanceof WorkspaceError && e.code === "relacao_invalida");
});

test("outra conta não enxerga os vínculos desta", async () => {
  const ctx = await setup();
  await linkContacts(ctx, { contactId: "a", relatedContactId: "b", relation: "socio" });
  const outraWs = await ensureWorkspace("loc_B", "user_2");
  const alheio = { tenantId: "loc_B", userKey: "user_2", role: "owner", workspaceId: outraWs.id };
  assert.deepEqual(await listRelations(alheio, "a"), []);
});

/* ---------------- agrupamento para a tela ---------------- */

test("os vínculos são agrupados por parentesco", () => {
  const grupos = groupRelations([
    { contactId: "1", relation: "filho" },
    { contactId: "2", relation: "conjuge" },
    { contactId: "3", relation: "filho" },
  ]);
  assert.deepEqual(grupos.map((g) => g.relation), ["conjuge", "filho"]);
  assert.equal(grupos.find((g) => g.relation === "filho").itens.length, 2);
});

test("rótulo que a versão futura gravar não some da tela", () => {
  const grupos = groupRelations([{ contactId: "1", relation: "padrinho" }]);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].nome, "Outros");
});

/**
 * Listas de CRM salvas: recortes de pipeline/estágio na navegação.
 *
 * O que mais importa aqui é a semeadura de Apólices: ela depende do CRM,
 * roda em toda leitura e não pode nem duplicar nem derrubar a lista
 * quando o CRM estiver fora.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { __clearGhlCache } from "../lib/server/ghl.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import {
  listCrmLists, createCrmList, updateCrmList, deleteCrmList,
} from "../lib/server/crm-lists.js";

const PIPELINES = [
  { id: "p1", name: "0. old 1- Prospects novos leads",
    stages: [{ id: "s1", name: "Novo Lead" }, { id: "s2", name: "Esperando Resposta" }] },
  { id: "p2", name: "2- Policies",
    stages: [{ id: "s3", name: "January" }, { id: "s4", name: "December" }] },
];

const realFetch = globalThis.fetch;

function stubCrm({ pipelines = PIPELINES, fail = false } = {}) {
  __clearGhlCache();
  process.env.GHL_LOCATION_TOKEN = "tok_teste";
  process.env.GHL_LOCATION_ID = "loc_teste";
  globalThis.fetch = async () => {
    if (fail) throw new Error("crm fora do ar");
    return {
      ok: true, status: 200, statusText: "200",
      headers: { get: () => null },
      text: async () => JSON.stringify({ pipelines }),
    };
  };
}

function restore() {
  globalThis.fetch = realFetch;
  delete process.env.GHL_LOCATION_TOKEN;
  delete process.env.GHL_LOCATION_ID;
}

async function setup(opts) {
  __setDbClient(createFakeDb());
  stubCrm(opts);
  const ws = await ensureWorkspace("loc_A", "user_1");
  return { tenantId: "loc_A", userKey: "user_1", role: "owner", workspaceId: ws.id };
}

test.afterEach(restore);

/* ---------------- semeadura ---------------- */

test("Apólices nasce pronta, achada pelo nome da pipeline", async () => {
  const ctx = await setup();
  const lists = await listCrmLists(ctx);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].name, "Apólices");
  assert.equal(lists[0].filters.pipelineId, "p2");
  assert.equal(lists[0].filters.stageId, undefined, "a lista é da pipeline inteira");
});

test("semear duas vezes não cria duas abas", async () => {
  const ctx = await setup();
  const a = await listCrmLists(ctx);
  const b = await listCrmLists(ctx);
  assert.equal(b.length, 1);
  assert.deepEqual(a.map((l) => l.id), b.map((l) => l.id));
});

test("conta sem pipeline de apólices simplesmente não ganha a aba", async () => {
  const ctx = await setup({ pipelines: [PIPELINES[0]] });
  assert.deepEqual(await listCrmLists(ctx), []);
});

test("CRM fora do ar devolve as listas que já existem, sem estourar", async () => {
  const ctx = await setup();
  await listCrmLists(ctx);                       // semeia com o CRM de pé
  stubCrm({ fail: true });
  const lists = await listCrmLists(ctx);
  assert.equal(lists.length, 1, "a leitura sobrevive à queda do CRM");
});

test("CRM fora do ar na primeira leitura devolve vazio, e semeia depois", async () => {
  const ctx = await setup({ fail: true });
  assert.deepEqual(await listCrmLists(ctx), []);
  stubCrm();
  assert.equal((await listCrmLists(ctx)).length, 1);
});

/* ---------------- criar, renomear, remover ---------------- */

test("criar lista de pipeline e estágio", async () => {
  const ctx = await setup();
  const list = await createCrmList(ctx, {
    name: "Prospects novos",
    icon: "🔥",
    filters: { pipelineId: "p1", pipelineName: "Prospects", stageId: "s1", stageName: "Novo Lead" },
  });
  assert.equal(list.name, "Prospects novos");
  assert.equal(list.filters.stageName, "Novo Lead");
  assert.equal(list.kind, "opportunities");
  // null no Postgres, undefined no duplo de banco: o que importa é não
  // carregar chave de semeadura, senão o unique index a trataria como
  // uma das listas prontas.
  assert.ok(!list.seed_key, "lista feita à mão não é semeada");
});

test("lista sem nome ou sem recorte é recusada", async () => {
  const ctx = await setup();
  await assert.rejects(() => createCrmList(ctx, { name: "  ", filters: { pipelineId: "p1" } }),
    (e) => e instanceof WorkspaceError && e.code === "missing_name");
  await assert.rejects(() => createCrmList(ctx, { name: "Sem recorte", filters: {} }),
    (e) => e instanceof WorkspaceError && e.code === "missing_filter");
});

test("filtro inventado não entra: o jsonb não vira depósito", async () => {
  const ctx = await setup();
  const list = await createCrmList(ctx, {
    name: "X",
    filters: { pipelineId: "p1", inventado: "x", stageId: 42, __proto__: "nope" },
  });
  assert.deepEqual(Object.keys(list.filters), ["pipelineId"]);
});

test("renomear e trocar o ícone", async () => {
  const ctx = await setup();
  const list = await createCrmList(ctx, { name: "X", filters: { pipelineId: "p1" } });
  const renamed = await updateCrmList(ctx, list.id, { name: "Carteira quente", icon: "⭐" });
  assert.equal(renamed.name, "Carteira quente");
  assert.equal(renamed.icon_value, "⭐");
  assert.deepEqual(renamed.filters, list.filters, "renomear não mexe no recorte");
});

test("remover tira a lista da navegação", async () => {
  const ctx = await setup();
  const list = await createCrmList(ctx, { name: "X", filters: { pipelineId: "p1" } });
  await deleteCrmList(ctx, list.id);
  const restantes = await listCrmLists(ctx);
  assert.equal(restantes.find((l) => l.id === list.id), undefined);
});

/* ---------------- isolamento entre contas ---------------- */

test("outra conta não enxerga nem altera a lista, mesmo com o id", async () => {
  const ctx = await setup();
  const list = await createCrmList(ctx, { name: "Minha", filters: { pipelineId: "p1" } });

  const outraWs = await ensureWorkspace("loc_B", "user_2");
  const outro = { tenantId: "loc_B", userKey: "user_2", role: "owner", workspaceId: outraWs.id };

  const vistas = await listCrmLists(outro);
  assert.equal(vistas.find((l) => l.id === list.id), undefined);

  await assert.rejects(() => updateCrmList(outro, list.id, { name: "Roubada" }),
    (e) => e instanceof WorkspaceError && e.code === "list_not_found");

  await deleteCrmList(outro, list.id);
  const aindaMinha = (await listCrmLists(ctx)).find((l) => l.id === list.id);
  assert.equal(aindaMinha.name, "Minha", "o delete de outra conta não apagou nada");
});

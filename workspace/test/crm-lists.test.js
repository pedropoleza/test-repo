/**
 * Listas de CRM salvas: recortes de pipeline/estágio na navegação.
 *
 * O que mais importa aqui é a semeadura: ela depende do CRM, roda em
 * toda leitura, e não pode nem duplicar, nem derrubar a lista quando o
 * CRM estiver fora, nem reorganizar a navegação de quem já montou a
 * dela.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient, db } from "../lib/server/db.js";
import { __clearGhlCache } from "../lib/server/ghl.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import {
  listCrmLists, createCrmList, updateCrmList, deleteCrmList,
} from "../lib/server/crm-lists.js";

const PIPELINES = [
  { id: "p1", name: "1 · Seguro de Vida — Prospects",
    stages: [{ id: "s1", name: "New Lead" }, { id: "s2", name: "Follow-up" }] },
  { id: "p2", name: "2 · Apólices Ativas",
    stages: [{ id: "s3", name: "Apólice Ativa" }, { id: "s4", name: "Renovação Próxima" }] },
  { id: "p3", name: "6 · Casos Jurídicos",
    stages: [{ id: "s5", name: "New Request" }, { id: "s6", name: "Delivered / Paid" }] },
];

/** A conta do teste usa a convenção de prefixo, como a real. */
const CAMPOS = [
  { id: "f1", name: "Seg · Carrier", dataType: "TEXT" },
  { id: "f2", name: "Seg · Prêmio", dataType: "MONETORY" },
  { id: "f3", name: "Seg · Nº da Apólice", dataType: "TEXT" },
  { id: "f4", name: "Jur · Tipo de Caso", dataType: "TEXT" },
  { id: "f5", name: "Jur · Advogado Responsável", dataType: "TEXT" },
  { id: "f6", name: "Monthly Premium", dataType: "NUMERICAL" },
];

const realFetch = globalThis.fetch;

function stubCrm({ pipelines = PIPELINES, campos = CAMPOS, fail = false } = {}) {
  __clearGhlCache();
  process.env.GHL_LOCATION_TOKEN = "tok_teste";
  process.env.GHL_LOCATION_ID = "loc_teste";
  globalThis.fetch = async (url) => {
    if (fail) throw new Error("crm fora do ar");
    const corpo = String(url).includes("customFields")
      ? { customFields: campos }
      : { pipelines };
    return {
      ok: true, status: 200, statusText: "200",
      headers: { get: () => null },
      text: async () => JSON.stringify(corpo),
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

test("cada pipeline da conta vira uma aba, na ordem do CRM", async () => {
  const ctx = await setup();
  const lists = await listCrmLists(ctx);
  assert.deepEqual(lists.map((l) => l.name),
    ["Seguro de Vida — Prospects", "Apólices Ativas", "Casos Jurídicos"]);
  // A numeração da conta é ordenação, não nome: já está em `position`.
  assert.ok(lists.every((l) => !/^\d/.test(l.name)), "sobrou número no nome");
  assert.deepEqual(lists.map((l) => l.filters.pipelineId), ["p1", "p2", "p3"]);
  assert.ok(lists.every((l) => !l.filters.stageId), "a aba é da pipeline inteira");
});

test("as abas nascem agrupadas por assunto", async () => {
  const ctx = await setup();
  const lists = await listCrmLists(ctx);
  assert.deepEqual(lists.map((l) => l.group_name), ["Seguros", "Seguros", "Serviços"]);
});

test("cada aba nasce com as colunas da sua própria pipeline", async () => {
  // É o ponto todo: a aba de apólices não mostra os campos jurídicos, e
  // a jurídica não mostra os de seguro.
  const ctx = await setup();
  const [prospects, apolices, juridico] = await listCrmLists(ctx);
  assert.deepEqual(apolices.filters.columns, ["cf_f1", "cf_f2", "cf_f3"]);
  assert.deepEqual(juridico.filters.columns, ["cf_f4", "cf_f5"]);
  assert.deepEqual(prospects.filters.columns, ["cf_f1", "cf_f2", "cf_f3"]);
});

test("conta sem convenção de prefixo ganha as abas, sem colunas extras", async () => {
  // A conta com 115 campos e nenhum prefixo: as abas existem, e cada uma
  // mostra os campos padrão, como sempre mostrou.
  const ctx = await setup({
    campos: [{ id: "a", name: "Monthly Premium" }, { id: "b", name: "Underwriting Status" }],
  });
  const lists = await listCrmLists(ctx);
  assert.equal(lists.length, 3);
  assert.ok(lists.every((l) => !l.filters.columns), "inventou coluna onde não há convenção");
});

test("semear duas vezes não cria duas abas", async () => {
  const ctx = await setup();
  const a = await listCrmLists(ctx);
  const b = await listCrmLists(ctx);
  assert.equal(b.length, 3);
  assert.deepEqual(a.map((l) => l.id), b.map((l) => l.id));
});

test("workspace que já tem página NÃO é reorganizado", async () => {
  // Uma conta que já montou a navegação dela não pode ganhar seis abas
  // de surpresa porque o app aprendeu a ler pipelines. A semeadura é
  // setup de primeira execução, não migração retroativa.
  const ctx = await setup();
  await db().from("workspace_pages").insert({
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: ctx.workspaceId, title: "Algo escrito", position: "a0",
  });
  assert.deepEqual(await listCrmLists(ctx), []);
});

test("pipeline nova depois da primeira execução não entra sozinha", async () => {
  const ctx = await setup();
  await listCrmLists(ctx);
  await db().from("workspace_pages").insert({
    id: "22222222-2222-4222-8222-222222222222",
    workspace_id: ctx.workspaceId, title: "Trabalho", position: "a0",
  });
  stubCrm({ pipelines: [...PIPELINES, { id: "p9", name: "9 · Nova", stages: [] }] });
  assert.equal((await listCrmLists(ctx)).length, 3, "a barra é de quem usa, não do CRM");
});

test("CRM fora do ar devolve as listas que já existem, sem estourar", async () => {
  const ctx = await setup();
  await listCrmLists(ctx);                       // semeia com o CRM de pé
  stubCrm({ fail: true });
  const lists = await listCrmLists(ctx);
  assert.equal(lists.length, 3, "a leitura sobrevive à queda do CRM");
});

test("CRM fora do ar na primeira leitura devolve vazio, e semeia depois", async () => {
  const ctx = await setup({ fail: true });
  assert.deepEqual(await listCrmLists(ctx), []);
  stubCrm();
  assert.equal((await listCrmLists(ctx)).length, 3);
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

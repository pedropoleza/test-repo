/**
 * Normalização CRM: contato/oportunidade do GHL → nosso formato.
 * Fixtures no shape documentado da API v2 do GoHighLevel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  STANDARD_CONTACT_FIELDS, customFieldsToColumns, tagsToOptions,
  contactToRecord, opportunityToRecord, customFieldKey,
} from "../src/shared/crm.js";

const CUSTOM_FIELDS = [
  { id: "cf1", name: "Orçamento",  dataType: "MONETARY" },
  { id: "cf2", name: "Interesse",  dataType: "SINGLE_OPTIONS", picklistOptions: ["Alto", "Baixo"] },
  { id: "cf3", name: "Canais",     dataType: "MULTIPLE_OPTIONS", picklistOptions: ["WhatsApp", "E-mail"] },
  { id: "cf4", name: "Retorno em", dataType: "DATE" },
  { id: "cf5", name: "Observação", dataType: "LARGE_TEXT" },
];

const CONTACT = {
  id: "ct_1",
  firstName: "Daniely",
  lastName: "Jones",
  email: "daniely@exemplo.com",
  phone: "+5511999999999",
  companyName: "Jones Co",
  city: "São Paulo", state: "SP", country: "BR",
  source: "Landing page",
  dnd: false,
  tags: ["Lead Quente", "Instagram"],
  dateAdded: "2026-03-04T12:30:00.000Z",
  dateUpdated: "2026-08-01T09:00:00.000Z",
  customFields: [
    { id: "cf1", value: "15000" },
    { id: "cf2", value: "Alto" },
    { id: "cf3", value: ["WhatsApp", "E-mail"] },
    { id: "cf4", value: "2026-09-15T00:00:00.000Z" },
    { id: "cf5", value: "Pediu proposta revisada" },
  ],
};

test("campos padrão viram colunas, com Nome como principal", () => {
  const primary = STANDARD_CONTACT_FIELDS.filter((f) => f.primary);
  assert.equal(primary.length, 1);
  assert.equal(primary[0].key, "name");
  const keys = STANDARD_CONTACT_FIELDS.map((f) => f.key);
  for (const k of ["email", "phone", "tags", "source", "company"]) assert.ok(keys.includes(k));
});

test("custom fields viram colunas com o tipo traduzido", () => {
  const cols = customFieldsToColumns(CUSTOM_FIELDS);
  const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
  assert.equal(byKey.cf_cf1.type, "number");
  assert.equal(byKey.cf_cf2.type, "select");
  assert.equal(byKey.cf_cf3.type, "multi_select");
  assert.equal(byKey.cf_cf4.type, "date");
  assert.equal(byKey.cf_cf5.type, "text");
  assert.equal(byKey.cf_cf1.name, "Orçamento");
});

test("a chave da coluna usa o id do GHL, não o nome", () => {
  // renomear o campo no GHL não pode reatribuir os dados de coluna
  const antes = customFieldsToColumns([{ id: "cf9", name: "Antigo", dataType: "TEXT" }])[0];
  const depois = customFieldsToColumns([{ id: "cf9", name: "Novo", dataType: "TEXT" }])[0];
  assert.equal(antes.key, depois.key);
  assert.equal(depois.name, "Novo");
});

test("opções de select saem da picklist", () => {
  const col = customFieldsToColumns(CUSTOM_FIELDS).find((c) => c.key === "cf_cf2");
  assert.deepEqual(col.options.map((o) => o.name), ["Alto", "Baixo"]);
});

test("contato vira registro com padrão e custom juntos", () => {
  const rec = contactToRecord(CONTACT, CUSTOM_FIELDS);
  assert.equal(rec.title, "Daniely Jones");
  assert.equal(rec.externalId, "ct_1");
  assert.equal(rec.properties.email, "daniely@exemplo.com");
  assert.equal(rec.properties.company, "Jones Co");
  assert.equal(rec.properties.dnd, false);
  assert.equal(rec.properties.created_at, "2026-03-04");
  assert.deepEqual(rec.properties.tags, ["lead quente", "instagram"]);
  assert.equal(rec.properties[customFieldKey({ id: "cf1" })], 15000);
  assert.equal(rec.properties.cf_cf2, "Alto");
  assert.deepEqual(rec.properties.cf_cf3, ["WhatsApp", "E-mail"]);
  assert.equal(rec.properties.cf_cf4, "2026-09-15");
  assert.equal(rec.properties.cf_cf5, "Pediu proposta revisada");
});

test("contato sem nome cai para email, depois telefone", () => {
  assert.equal(contactToRecord({ id: "a", email: "x@y.com" }).title, "x@y.com");
  assert.equal(contactToRecord({ id: "b", phone: "+551133334444" }).title, "+551133334444");
  assert.equal(contactToRecord({ id: "c" }).title, "Sem nome");
});

test("valores fora do formato não derrubam a linha", () => {
  const rec = contactToRecord({
    id: "z",
    firstName: "Teste",
    dateAdded: "data-invalida",
    customFields: [
      { id: "cf1", value: "não é número" },
      { id: "cf4", value: "nem data" },
      { id: "desconhecido", value: "campo que sumiu do GHL" },
    ],
  }, CUSTOM_FIELDS);
  assert.equal(rec.title, "Teste");
  assert.equal(rec.properties.created_at, null);
  assert.equal(rec.properties.cf_cf1, null);
  assert.equal(rec.properties.cf_cf4, null);
  assert.equal(rec.properties.cf_desconhecido, "campo que sumiu do GHL");
});

test("tags da location viram opções da coluna Tags", () => {
  const opts = tagsToOptions([{ name: "Lead Quente" }, "Instagram"]);
  assert.deepEqual(opts.map((o) => o.id), ["lead quente", "instagram"]);
  // o id casa com o valor gravado no registro, senão o chip não pinta
  const rec = contactToRecord(CONTACT, CUSTOM_FIELDS);
  for (const t of rec.properties.tags) assert.ok(opts.some((o) => o.id === t));
});

test("oportunidade resolve pipeline e estágio pelos ids", () => {
  const pipelines = [{
    id: "p1", name: "Comercial",
    stages: [{ id: "s1", name: "Novo" }, { id: "s2", name: "Proposta" }],
  }];
  const rec = opportunityToRecord({
    id: "op1", name: "Contrato anual", status: "open", monetaryValue: 4800,
    pipelineId: "p1", pipelineStageId: "s2",
    contact: { name: "Daniely Jones" }, assignedTo: "u1",
    createdAt: "2026-07-01T10:00:00.000Z",
  }, pipelines);

  assert.equal(rec.title, "Contrato anual");
  assert.equal(rec.properties.pipeline, "Comercial");
  assert.equal(rec.properties.stage, "Proposta");
  assert.equal(rec.properties.value, 4800);
  assert.equal(rec.properties.contact, "Daniely Jones");
  assert.equal(rec.properties.created_at, "2026-07-01");
});

test("pipeline desconhecido não quebra a oportunidade", () => {
  const rec = opportunityToRecord({ id: "op2", name: "Solta", pipelineId: "sumiu" }, []);
  assert.equal(rec.properties.pipeline, "");
  assert.equal(rec.properties.stage, "");
});

test("oportunidade carrega o id do contato, para abrir a pasta dele", () => {
  const a = opportunityToRecord({ id: "o1", name: "X", contactId: "ct_9" }, []);
  assert.equal(a.contactId, "ct_9");
  const b = opportunityToRecord({ id: "o2", name: "Y", contact: { id: "ct_7", name: "Ana" } }, []);
  assert.equal(b.contactId, "ct_7");
  const c = opportunityToRecord({ id: "o3", name: "Z" }, []);
  assert.equal(c.contactId, null);
});

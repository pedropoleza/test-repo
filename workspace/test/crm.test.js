/**
 * Normalização CRM: contato/oportunidade do GHL → nosso formato.
 * Fixtures no shape documentado da API v2 do GoHighLevel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  STANDARD_CONTACT_FIELDS, customFieldsToColumns, tagsToOptions,
  contactToRecord, opportunityToRecord, customFieldKey,
  usersToOptions, isWritable, opportunityPatch, contactPatch,
  stageOptions, stageColor,
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

/* ------------------------------------------------------------------ */
/* Responsável: id do usuário → nome                                  */
/* ------------------------------------------------------------------ */

const USERS = [
  { id: "u1", firstName: "Daniely", lastName: "Jones", email: "d@x.com" },
  { id: "u2", name: "Karen .", email: "k@x.com" },
  { id: "u3", email: "so-email@x.com" },
];

test("usuários viram opções que traduzem o id para o nome", () => {
  const options = usersToOptions(USERS);
  assert.deepEqual(options.map((o) => o.name), ["Daniely Jones", "Karen .", "so-email@x.com"]);
  assert.deepEqual(options.map((o) => o.id), ["u1", "u2", "u3"]);
});

test("responsável que saiu da conta ainda aparece, em vez de sumir", () => {
  const options = usersToOptions(USERS, ["u1", "u9", "u9", null]);
  const orfao = options.find((o) => o.id === "u9");
  assert.equal(orfao.name, "Usuário removido");
  assert.equal(options.filter((o) => o.id === "u9").length, 1, "não duplica o mesmo id");
});

test("a coluna Responsável guarda o id, que as opções resolvem", () => {
  const record = opportunityToRecord({ id: "o1", name: "X", assignedTo: "u1" }, []);
  assert.equal(record.properties.assigned, "u1");
  const options = usersToOptions(USERS);
  assert.equal(options.find((o) => o.id === record.properties.assigned).name, "Daniely Jones");
});

/* ------------------------------------------------------------------ */
/* Fronteira de escrita                                               */
/* ------------------------------------------------------------------ */

test("só as colunas graváveis são editáveis", () => {
  assert.equal(isWritable("opportunities", "status"), true);
  assert.equal(isWritable("opportunities", "stage"), true);
  assert.equal(isWritable("opportunities", "contact"), false, "contato é derivado");
  assert.equal(isWritable("opportunities", "created_at"), false);

  assert.equal(isWritable("contacts", "phone"), true);
  assert.equal(isWritable("contacts", "cf_abc"), true);
  assert.equal(isWritable("contacts", "source"), false, "origem é do momento da criação");
  assert.equal(isWritable("contacts", "created_at"), false);
});

test("custom field que não volta como texto não é editável", () => {
  const [anexo] = customFieldsToColumns([{ id: "cf9", name: "Contrato", dataType: "FILE_UPLOAD" }]);
  assert.equal(anexo.readOnly, true);
  assert.equal(isWritable("contacts", anexo), false);
});

test("patch da oportunidade traduz só o que é gravável", () => {
  const body = opportunityPatch({
    status: "won", value: "1.234,50", assigned: "u1", stage: "Novo", inventado: 1,
  });
  assert.deepEqual(body, { status: "won", monetaryValue: 1234.5, assignedTo: "u1" });
});

test("valor vazio vira zero, não NaN", () => {
  assert.deepEqual(opportunityPatch({ value: "" }), { monetaryValue: 0 });
  assert.deepEqual(opportunityPatch({ value: null }), { monetaryValue: 0 });
});

test("nome do contato é quebrado no primeiro espaço", () => {
  assert.deepEqual(contactPatch({ name: "Maria de Souza Lima" }),
    { firstName: "Maria", lastName: "de Souza Lima" });
  assert.deepEqual(contactPatch({ name: "Karen" }), { firstName: "Karen", lastName: null });
});

test("apagar um campo manda null, porque o CRM ignora string vazia", () => {
  assert.deepEqual(contactPatch({ city: "" }), { city: null });
  assert.deepEqual(contactPatch({ phone: "   " }), { phone: null });
  assert.deepEqual(contactPatch({ cf_cf1: "" }), { customFields: [{ id: "cf1", value: null }] });
  assert.deepEqual(opportunityPatch({ name: "" }), { name: null });
});

test("custom fields do contato voltam a ser o id que o CRM conhece", () => {
  const body = contactPatch({ cf_cf1: "500", city: "Orlando", inventado: "x" });
  assert.deepEqual(body, { city: "Orlando", customFields: [{ id: "cf1", value: "500" }] });
});

test("tags e não-perturbe mantêm o tipo que o CRM espera", () => {
  assert.deepEqual(contactPatch({ tags: ["vip"], dnd: 1 }), { tags: ["vip"], dnd: true });
  assert.deepEqual(contactPatch({ tags: null }), { tags: [] });
});

test("patch vazio não vira PUT", () => {
  assert.deepEqual(opportunityPatch({ contact: "x", created_at: "2026-01-01" }), {});
  assert.deepEqual(contactPatch({ source: "site" }), {});
});

/* ------------------------------------------------------------------ */
/* Cores dos estágios                                                 */
/* ------------------------------------------------------------------ */

const PIPE = (nome, stages) => ({
  id: nome, name: nome, stages: stages.map((n, i) => ({ id: `${nome}-${i}`, name: n })),
});

test("a cor do estágio acompanha a posição no funil", () => {
  const options = stageOptions([PIPE("P", ["Entrada", "Contato", "Reunião", "Proposta"])]);
  const cores = options.map((o) => o.color);
  assert.equal(cores[0], "gray", "quem entrou agora é frio");
  assert.equal(cores.at(-1), "green", "o fim do funil é verde");
  assert.equal(new Set(cores).size, cores.length, "cada etapa tem a sua cor");
});

test("a escala se estica para pipelines de tamanhos diferentes", () => {
  const curta = stageOptions([PIPE("A", ["Um", "Dois"])]).map((o) => o.color);
  const longa = stageOptions([PIPE("B", ["a", "b", "c", "d", "e", "f", "g", "h"])]).map((o) => o.color);
  assert.equal(curta[0], "gray");
  assert.equal(curta.at(-1), "green");
  assert.equal(longa[0], "gray");
  assert.equal(longa.at(-1), "green");
});

test("desfecho tem cor fixa, não a da posição", () => {
  assert.equal(stageColor("Lead Perdido", 1, 8), "red");
  assert.equal(stageColor("Cancelado", 0, 8), "red");
  assert.equal(stageColor("Negócio Ganho", 1, 8), "green");
});

test("estágio de mesmo nome em dois pipelines não muda de cor", () => {
  const options = stageOptions([
    PIPE("A", ["Novo Lead", "Contato", "Fim"]),
    PIPE("B", ["Outro", "Novo Lead"]),
  ]);
  assert.equal(options.filter((o) => o.id === "Novo Lead").length, 1);
});

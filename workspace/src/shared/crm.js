/**
 * Normalização CRM: contato do GHL → registro da nossa tabela.
 *
 * Compartilhado entre browser e servidor, como os outros shared/. O GHL
 * é fonte de EVENTO/DADO; o formato que a interface consome é o nosso —
 * a mesma doutrina que o Hub já segue (decisão D3).
 *
 * Campos padrão viram colunas fixas; custom fields viram colunas com a
 * chave `cf_<id>`, para que renomear o campo no GHL não quebre a coluna.
 */

/** Colunas derivadas dos campos padrão do contato. */
export const STANDARD_CONTACT_FIELDS = [
  { key: "name",        name: "Nome",       type: "text",         primary: true },
  { key: "email",       name: "E-mail",     type: "email" },
  { key: "phone",       name: "Telefone",   type: "phone" },
  { key: "tags",        name: "Tags",       type: "multi_select" },
  { key: "source",      name: "Origem",     type: "text" },
  { key: "company",     name: "Empresa",    type: "text" },
  { key: "city",        name: "Cidade",     type: "text" },
  { key: "state",       name: "Estado",     type: "text" },
  { key: "country",     name: "País",       type: "text" },
  { key: "dnd",         name: "Não perturbe", type: "checkbox" },
  { key: "created_at",  name: "Criado em",  type: "date" },
  { key: "updated_at",  name: "Atualizado", type: "date" },
];

/** GHL custom field → tipo de coluna nosso. */
const CUSTOM_FIELD_TYPE = {
  TEXT: "text",
  LARGE_TEXT: "text",
  NUMERICAL: "number",
  MONETARY: "number",
  PHONE: "phone",
  EMAIL: "email",
  DATE: "date",
  CHECKBOX: "multi_select",
  SINGLE_OPTIONS: "select",
  MULTIPLE_OPTIONS: "multi_select",
  RADIO: "select",
  TEXTBOX_LIST: "text",
  FILE_UPLOAD: "text",
};

export function customFieldKey(field) {
  return `cf_${field.id}`;
}

/** Converte a lista de custom fields do GHL em definições de coluna. */
export function customFieldsToColumns(customFields = []) {
  return customFields
    .filter((f) => f && f.id)
    .map((f) => {
      const type = CUSTOM_FIELD_TYPE[f.dataType] || "text";
      const column = {
        key: customFieldKey(f),
        name: f.name || f.fieldKey || "Campo",
        type,
        source: "ghl_custom_field",
        externalId: f.id,
      };
      if (["select", "multi_select"].includes(type)) {
        const options = Array.isArray(f.picklistOptions) ? f.picklistOptions : [];
        column.options = options.map((o) => {
          const label = typeof o === "string" ? o : (o?.value ?? o?.label ?? "");
          return { id: String(label), name: String(label), color: "gray" };
        });
      }
      return column;
    });
}

/** Tags da location viram as opções da coluna Tags. */
export function tagsToOptions(tags = []) {
  return tags
    .filter((t) => t && (t.name || typeof t === "string"))
    .map((t) => {
      const name = typeof t === "string" ? t : t.name;
      return { id: String(name).toLowerCase(), name: String(name), color: "blue" };
    });
}

function fullName(contact) {
  const composed = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return contact.contactName || composed || contact.name || contact.email || contact.phone || "Sem nome";
}

function isoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Contato do GHL → registro no nosso formato.
 * `customFields` é a lista de definições, usada para mapear id → chave.
 */
export function contactToRecord(contact, customFields = []) {
  const byId = new Map(customFields.filter((f) => f?.id).map((f) => [f.id, f]));
  const properties = {
    email: contact.email || "",
    phone: contact.phone || "",
    tags: (contact.tags || []).map((t) => String(t).toLowerCase()),
    source: contact.source || "",
    company: contact.companyName || "",
    city: contact.city || "",
    state: contact.state || "",
    country: contact.country || "",
    dnd: contact.dnd === true,
    created_at: isoDate(contact.dateAdded || contact.createdAt),
    updated_at: isoDate(contact.dateUpdated || contact.updatedAt),
  };

  for (const raw of contact.customFields || []) {
    const id = raw?.id || raw?.customFieldId;
    if (!id) continue;
    const def = byId.get(id);
    const key = `cf_${id}`;
    const value = raw.value ?? raw.fieldValue ?? raw.selectedOptions ?? null;
    const type = def ? (CUSTOM_FIELD_TYPE[def.dataType] || "text") : "text";

    if (type === "multi_select") {
      properties[key] = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []);
    } else if (type === "number") {
      const n = Number(value);
      properties[key] = Number.isFinite(n) ? n : null;
    } else if (type === "date") {
      properties[key] = isoDate(value);
    } else {
      properties[key] = value == null ? "" : String(value);
    }
  }

  return {
    externalId: contact.id,
    title: fullName(contact),
    properties,
  };
}

/** Oportunidade do GHL → registro, com o estágio do pipeline resolvido. */
export function opportunityToRecord(opp, pipelines = []) {
  const pipeline = pipelines.find((p) => p.id === opp.pipelineId);
  const stage = pipeline?.stages?.find((s) => s.id === opp.pipelineStageId);
  return {
    externalId: opp.id,
    title: opp.name || "Sem nome",
    properties: {
      status: opp.status || "",
      value: Number(opp.monetaryValue) || null,
      pipeline: pipeline?.name || "",
      stage: stage?.name || "",
      contact: opp.contact?.name || opp.contactId || "",
      assigned: opp.assignedTo || "",
      created_at: isoDate(opp.createdAt),
      updated_at: isoDate(opp.updatedAt),
    },
  };
}

export const OPPORTUNITY_FIELDS = [
  { key: "name",       name: "Oportunidade", type: "text", primary: true },
  { key: "stage",      name: "Estágio",      type: "select" },
  { key: "status",     name: "Status",       type: "select" },
  { key: "value",      name: "Valor",        type: "number" },
  { key: "pipeline",   name: "Pipeline",     type: "select" },
  { key: "contact",    name: "Contato",      type: "text" },
  { key: "assigned",   name: "Responsável",  type: "person" },
  { key: "created_at", name: "Criado em",    type: "date" },
];

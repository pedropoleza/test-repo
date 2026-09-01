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
import { parseNumberPtBr } from "./fields.js";


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
      if (["FILE_UPLOAD", "TEXTBOX_LIST"].includes(f.dataType)) {
        // O valor que a API devolve para estes tipos é uma representação,
        // não o conteúdo: regravá-lo como texto destruiria o original.
        column.readOnly = true;
      }
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

/**
 * Usuários da conta → opções da coluna "Responsável".
 *
 * O valor guardado na propriedade é o id do usuário; quem traduz para
 * nome é a lista de opções. `seenIds` recebe os ids que aparecem nos
 * registros: um responsável que saiu da conta não está mais em /users,
 * e sem uma opção para ele a célula ficaria vazia — pior que mostrar o
 * id, porque some a informação de que existe alguém atribuído.
 */
export function usersToOptions(users = [], seenIds = []) {
  const options = users
    .filter((u) => u && u.id)
    .map((u) => ({ id: u.id, name: userName(u), color: "blue" }));

  const known = new Set(options.map((o) => o.id));
  for (const id of seenIds) {
    if (id && !known.has(id)) {
      known.add(id);
      options.push({ id, name: "Usuário removido", color: "gray" });
    }
  }
  return options;
}

export function userName(user) {
  if (!user) return "";
  const composed = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return user.name || composed || user.email || user.id || "";
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
    // Guardado fora de properties: não é coluna, é o elo para abrir a
    // pasta do contato a partir da oportunidade.
    contactId: opp.contactId || opp.contact?.id || null,
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
  { key: "assigned",   name: "Responsável",  type: "select" },
  { key: "created_at", name: "Criado em",    type: "date" },
];

/* ------------------------------------------------------------------ */
/* Cores dos estágios                                                 */
/* ------------------------------------------------------------------ */

/**
 * A cor do estágio conta em que ponto do funil a oportunidade está.
 *
 * A progressão vai do frio ao quente e termina em verde: cinza para quem
 * acabou de entrar, azul e roxo no meio da conversa, amarelo e laranja
 * quando está perto de decidir, verde no fim. Assim uma coluna de
 * estágios já mostra, pela cor, onde a carteira está parada — sem ter
 * que ler estágio por estágio.
 *
 * Desfecho tem cor fixa, porque ganhar e perder não são "mais adiante no
 * funil": são saídas. Perdido é vermelho em qualquer posição.
 */
const STAGE_PROGRESSION = ["gray", "blue", "purple", "yellow", "orange", "green"];

const PERDIDO = /perd|lost|cancel|abandon|descart|desqualific|n[aã]o\s*(quis|fechou)/i;
const GANHO = /ganho|ganha|won|fechad|vendid|cliente|assinad|aprovad/i;

export function stageColor(stageName, index = 0, total = 1) {
  const nome = String(stageName || "");
  if (PERDIDO.test(nome)) return "red";
  if (GANHO.test(nome)) return "green";
  if (total <= 1) return STAGE_PROGRESSION[0];
  // Espalha os estágios pela progressão inteira, seja a pipeline de 3 ou
  // de 12 estágios: o que importa é a posição relativa no funil.
  const passo = (index / (total - 1)) * (STAGE_PROGRESSION.length - 1);
  return STAGE_PROGRESSION[Math.round(passo)];
}

/**
 * Opções da coluna "Estágio", com a cor de cada um.
 *
 * A chave é o NOME do estágio, porque é o que a célula guarda. Dois
 * pipelines podem ter estágios de mesmo nome; fica a cor do primeiro,
 * senão a mesma palavra apareceria de duas cores na mesma tela.
 */
export function stageOptions(pipelines = []) {
  const vistos = new Map();
  for (const pipe of pipelines) {
    const stages = pipe.stages || [];
    stages.forEach((stage, i) => {
      const nome = stage?.name;
      if (!nome || vistos.has(nome)) return;
      vistos.set(nome, {
        id: nome,
        name: nome,
        color: stageColor(nome, i, stages.length),
      });
    });
  }
  return [...vistos.values()];
}

/* ------------------------------------------------------------------ */
/* Escrita de volta no CRM                                            */
/* ------------------------------------------------------------------ */

/** Status da oportunidade, com rótulo em português. */
export const OPPORTUNITY_STATUS = [
  { id: "open",      name: "Aberta",      color: "blue" },
  { id: "won",       name: "Ganha",       color: "green" },
  { id: "lost",      name: "Perdida",     color: "red" },
  { id: "abandoned", name: "Abandonada",  color: "gray" },
];

/**
 * Colunas que a interface pode gravar de volta, e para qual campo do CRM
 * cada uma vai.
 *
 * A lista é a fronteira de escrita: o servidor só monta um PUT com o que
 * está aqui. Uma coluna ausente é somente-leitura por construção, não por
 * esquecimento da interface — `source`, `created_at` e `updated_at` são
 * derivados e não têm o que gravar.
 *
 * `stage`/`pipeline` ficam de fora de propósito: mover a oportunidade é
 * uma operação sobre os dois campos juntos e tem caminho próprio.
 */
export const OPPORTUNITY_WRITABLE = {
  name:     { field: "name",          type: "text" },
  status:   { field: "status",        type: "select" },
  value:    { field: "monetaryValue", type: "number" },
  assigned: { field: "assignedTo",    type: "select" },
};

export const CONTACT_WRITABLE = {
  name:    { field: "name",        type: "text" },
  email:   { field: "email",       type: "email" },
  phone:   { field: "phone",       type: "phone" },
  tags:    { field: "tags",        type: "multi_select" },
  company: { field: "companyName", type: "text" },
  city:    { field: "city",        type: "text" },
  state:   { field: "state",       type: "text" },
  country: { field: "country",     type: "text" },
  dnd:     { field: "dnd",         type: "checkbox" },
};

/**
 * A coluna pode ser editada nesta visão? Aceita a coluna inteira, porque
 * a chave sozinha não diz se aquele custom field é regravável.
 */
export function isWritable(kind, column) {
  const field = typeof column === "string" ? { key: column } : (column || {});
  const key = field.key;
  if (!key || field.readOnly) return false;

  if (kind === "opportunities") {
    return key === "stage" || key === "pipeline"
      || Object.prototype.hasOwnProperty.call(OPPORTUNITY_WRITABLE, key);
  }
  return Object.prototype.hasOwnProperty.call(CONTACT_WRITABLE, key)
    || key.startsWith("cf_");
}

/**
 * `{ chave: valor }` da nossa tabela → corpo do PUT da oportunidade.
 * Chave desconhecida é ignorada, não vira campo solto no CRM.
 */
/**
 * Campo de texto vazio vai como null, não como "".
 *
 * O CRM IGNORA string vazia num PUT — o campo simplesmente fica como
 * estava. Quem apagasse o conteúdo de uma célula veria a interface
 * limpar e o valor antigo voltar no próximo carregamento. Com null o
 * campo é de fato apagado.
 */
function vazioComoNulo(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

export function opportunityPatch(changes = {}) {
  const body = {};
  for (const [key, value] of Object.entries(changes)) {
    const spec = OPPORTUNITY_WRITABLE[key];
    if (!spec) continue;
    if (spec.type === "number") {
      // Um número ilegível vira 0 e não NaN: NaN sai do JSON como null e
      // o CRM guardaria "sem valor" no lugar do que estava lá.
      const n = typeof value === "number" ? value : parseNumberPtBr(String(value ?? ""));
      body[spec.field] = Number.isFinite(n) ? n : 0;
    } else {
      body[spec.field] = vazioComoNulo(value);
    }
  }
  return body;
}

/**
 * Idem para o contato. Dois casos não são um de-para direto:
 *
 * - `name` é um campo só na tabela e dois no CRM. Quebramos no primeiro
 *   espaço: o resto vira sobrenome, porque "Maria de Souza Lima" com
 *   sobrenome "de" seria pior que um sobrenome comprido.
 * - custom fields entram todos juntos em `customFields`, então a chave
 *   `cf_<id>` precisa voltar a ser o id que o CRM conhece.
 */
export function contactPatch(changes = {}) {
  const body = {};
  const customFields = [];

  for (const [key, value] of Object.entries(changes)) {
    if (key.startsWith("cf_")) {
      customFields.push({ id: key.slice(3), value: Array.isArray(value) ? value : vazioComoNulo(value) });
      continue;
    }
    const spec = CONTACT_WRITABLE[key];
    if (!spec) continue;

    if (key === "name") {
      const nome = String(value ?? "").trim();
      const corte = nome.indexOf(" ");
      body.firstName = vazioComoNulo(corte === -1 ? nome : nome.slice(0, corte));
      body.lastName = corte === -1 ? null : vazioComoNulo(nome.slice(corte + 1));
    } else if (spec.type === "checkbox") {
      body[spec.field] = !!value;
    } else if (spec.type === "multi_select") {
      body[spec.field] = Array.isArray(value) ? value : [];
    } else {
      body[spec.field] = vazioComoNulo(value);
    }
  }

  if (customFields.length) body.customFields = customFields;
  return body;
}
